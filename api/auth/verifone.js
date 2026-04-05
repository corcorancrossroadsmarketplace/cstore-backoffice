// api/auth/verifone.js
// Obtains a Verifone PDRS Bearer token for a store.
//
// Strategy (in order):
//   1. Resource Owner Password Credentials (ROPC) grant — pure HTTP, no browser
//   2. Playwright via Browserless.io — headless Chrome, handles reCAPTCHA
//
// Env vars required:
//   BROWSERLESS_TOKEN  — from browserless.io (free tier fine for ~30 refreshes/day)
//   ENCRYPTION_KEY     — 64-char hex, for decrypting stored credentials

import { query } from '../_lib/db.js';
import { decrypt } from '../_lib/crypto.js';
import { saveToken } from '../_lib/tokenStore.js';

const VERIFONE_TOKEN_ENDPOINT = 'https://us.vic.verifone.cloud/am/oauth2/access_token';
const VERIFONE_LOGIN_URL = 'https://us.live.verifone.cloud/';
const VERIFONE_CLIENT_ID = 'CommonPortal';
const TOKEN_EXPIRY_SECONDS = 3600;

// ─── Entry point ─────────────────────────────────────────────────────────────

/**
 * Fetches a fresh Verifone token for the given store.
 * Tries ROPC first, falls back to Playwright.
 * On success, saves the token to Neon and returns it.
 *
 * @param {number} storeId
 * @returns {Promise<string>} Bearer token
 */
export async function refreshTokenForStore(storeId) {
  const creds = await getDecryptedCredentials(storeId);
  if (!creds) throw new Error(`No credentials saved for store ${storeId}`);

  // Attempt 1: Password grant (fast, no browser needed)
  try {
    const token = await tryPasswordGrant(creds.username, creds.password);
    await saveToken(storeId, token, TOKEN_EXPIRY_SECONDS, 'password_grant');
    console.log(`[auth] store ${storeId}: token obtained via password_grant`);
    return token;
  } catch (err) {
    console.warn(`[auth] store ${storeId}: password_grant failed (${err.message}), trying playwright...`);
  }

  // Attempt 2: Playwright via Browserless
  const token = await tryPlaywright(creds.username, creds.password);
  await saveToken(storeId, token, TOKEN_EXPIRY_SECONDS, 'playwright');
  console.log(`[auth] store ${storeId}: token obtained via playwright`);
  return token;
}

// ─── Method 1: ROPC (Resource Owner Password Credentials) ────────────────────
// Many OIDC servers allow this for programmatic access even when the web UI
// requires reCAPTCHA. Worth trying first — it's instant and has no dependencies.

async function tryPasswordGrant(username, password) {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: VERIFONE_CLIENT_ID,
    username,
    password,
    scope: 'openid profile',
  });

  const res = await fetch(VERIFONE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`No access_token in response: ${JSON.stringify(data).slice(0, 200)}`);
  }

  return data.access_token;
}

// ─── Method 2: Playwright via Browserless.io ─────────────────────────────────
// Connects to a real Chrome instance running in the cloud.
// reCAPTCHA v3 (score-based) passes in a real browser automatically.
// reCAPTCHA v2 (checkbox) may need additional handling — will log if encountered.

async function tryPlaywright(username, password) {
  const token = process.env.BROWSERLESS_TOKEN;
  if (!token) throw new Error('BROWSERLESS_TOKEN env var not set');

  // Dynamic import — playwright-core not needed at cold start
  const { chromium } = await import('playwright-core');

  const wsEndpoint = `wss://chrome.browserless.io?token=${token}&stealth=true`;

  let browser;
  try {
    browser = await chromium.connectOverCDP(wsEndpoint, { timeout: 30000 });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
    });

    let capturedToken = null;

    // Intercept all requests — capture the Bearer token when it appears
    await context.route('**/*', async (route, request) => {
      const authHeader = request.headers()['authorization'];
      if (authHeader?.startsWith('Bearer ') && !capturedToken) {
        capturedToken = authHeader.replace('Bearer ', '');
        console.log('[playwright] captured Bearer token from intercepted request');
      }
      await route.continue();
    });

    const page = await context.newPage();

    // Navigate to C-Site Management
    await page.goto(VERIFONE_LOGIN_URL, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for login form
    await page.waitForSelector('input[type="text"], input[name="username"], input[id*="user"]', {
      timeout: 15000,
    });

    // Fill username
    const usernameField = await page.$(
      'input[name="username"], input[id*="username"], input[id*="user"], input[type="text"]'
    );
    if (!usernameField) throw new Error('Could not find username field');
    await usernameField.click({ clickCount: 3 });
    await usernameField.type(username, { delay: 50 });

    // Fill password
    const passwordField = await page.$('input[type="password"]');
    if (!passwordField) throw new Error('Could not find password field');
    await passwordField.click();
    await passwordField.type(password, { delay: 50 });

    // Submit
    const submitBtn = await page.$(
      'button[type="submit"], input[type="submit"], button:has-text("Sign In"), button:has-text("Login")'
    );
    if (submitBtn) {
      await submitBtn.click();
    } else {
      await passwordField.press('Enter');
    }

    // Wait for post-login navigation (dashboard loads, which triggers API calls)
    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});

    // Give the app a moment to make authenticated API calls
    await page.waitForTimeout(3000);

    // Also try extracting token directly from browser storage
    if (!capturedToken) {
      capturedToken = await page.evaluate(() => {
        // Check localStorage and sessionStorage for common token key patterns
        const keys = [
          ...Object.keys(localStorage),
          ...Object.keys(sessionStorage),
        ];
        for (const key of keys) {
          const val = localStorage.getItem(key) || sessionStorage.getItem(key);
          try {
            const parsed = JSON.parse(val);
            if (parsed?.access_token) return parsed.access_token;
            if (parsed?.token) return parsed.token;
            if (parsed?.id_token) return parsed.id_token;
          } catch {}
          // Raw token string
          if (val && val.split('.').length === 3 && val.length > 100) return val;
        }
        return null;
      });
      if (capturedToken) {
        console.log('[playwright] captured token from browser storage');
      }
    }

    if (!capturedToken) {
      // Log page state for debugging
      const url = page.url();
      console.error(`[playwright] login failed. Current URL: ${url}`);
      throw new Error('Login appeared to succeed but no token was captured. Check credentials.');
    }

    return capturedToken;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ─── Credential decryption ────────────────────────────────────────────────────

async function getDecryptedCredentials(storeId) {
  const res = await query(
    `SELECT encrypted_username, encrypted_password, iv, auth_tag
     FROM store_credentials WHERE store_id = $1`,
    [storeId]
  );
  if (!res.rows.length) return null;

  const row = res.rows[0];
  const ivs = JSON.parse(row.iv);
  const tags = JSON.parse(row.auth_tag);

  return {
    username: decrypt(row.encrypted_username, ivs.user, tags.user),
    password: decrypt(row.encrypted_password, ivs.pass, tags.pass),
  };
}
