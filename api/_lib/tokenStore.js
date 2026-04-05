// api/_lib/tokenStore.js
// Manages Verifone Bearer JWT storage in Neon
// Tokens expire in 3600s; we refresh at 3000s (50 min) to stay safe

import { query } from './db.js';

const TOKEN_REFRESH_BUFFER_SECONDS = 600; // refresh 10 min before expiry

/**
 * Returns the stored token for a store if still valid.
 * Returns null if missing or expiring soon.
 */
export async function getValidToken(storeId) {
  const res = await query(
    `SELECT bearer_token, expires_at
     FROM auth_tokens
     WHERE store_id = $1
       AND expires_at > NOW() + INTERVAL '${TOKEN_REFRESH_BUFFER_SECONDS} seconds'`,
    [storeId]
  );
  return res.rows[0]?.bearer_token ?? null;
}

/**
 * Saves or updates a token for a store.
 * @param {number} storeId
 * @param {string} bearerToken
 * @param {number} expiresInSeconds - from the OAuth response (typically 3600)
 * @param {string} method - 'password_grant' | 'playwright'
 */
export async function saveToken(storeId, bearerToken, expiresInSeconds = 3600, method = 'unknown') {
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
  await query(
    `INSERT INTO auth_tokens (store_id, bearer_token, expires_at, method)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (store_id) DO UPDATE
       SET bearer_token = EXCLUDED.bearer_token,
           expires_at   = EXCLUDED.expires_at,
           method       = EXCLUDED.method,
           updated_at   = NOW()`,
    [storeId, bearerToken, expiresAt, method]
  );
}

/**
 * Returns all store IDs that have saved credentials but need a fresh token.
 * Used by the refresh cron.
 */
export async function getStoresNeedingRefresh() {
  const res = await query(
    `SELECT sc.store_id, s.service_id, s.site_id
     FROM store_credentials sc
     JOIN stores s ON s.id = sc.store_id
     WHERE NOT EXISTS (
       SELECT 1 FROM auth_tokens at
       WHERE at.store_id = sc.store_id
         AND at.expires_at > NOW() + INTERVAL '${TOKEN_REFRESH_BUFFER_SECONDS} seconds'
     )`
  );
  return res.rows;
}

/**
 * Returns all store IDs that have a valid token (ready for ingest).
 */
export async function getStoresWithValidTokens() {
  const res = await query(
    `SELECT s.id as store_id, s.service_id, s.site_id, at.bearer_token
     FROM auth_tokens at
     JOIN stores s ON s.id = at.store_id
     WHERE at.expires_at > NOW() + INTERVAL '${TOKEN_REFRESH_BUFFER_SECONDS} seconds'`
  );
  return res.rows;
}
