// api/cron/ingest.js
// Vercel cron: runs every 1 minute
// Pulls transactions from Verifone PDRS TLog API for all stores with valid tokens
// Upserts to Neon — deduplicates by transaction id
//
// vercel.json config:
//   { "path": "/api/cron/ingest", "schedule": "* * * * *" }

import { query } from '../_lib/db.js';
import { getStoresWithValidTokens, getValidToken } from '../_lib/tokenStore.js';
import { refreshTokenForStore } from '../auth/verifone.js';

const PDRS_BASE = 'https://us.portal.gsc-petro.verifone.cloud/oidc/pdrs/v1/tlogs/transactions/financial';
const LOOKBACK_MINUTES = 5; // how far back to pull on each run (overlap prevents gaps)
const LIMIT_PER_REQUEST = 50;

export default async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const stores = await getStoresWithValidTokens();

  if (stores.length === 0) {
    return res.status(200).json({ message: 'No stores with valid tokens' });
  }

  const results = await Promise.allSettled(
    stores.map((store) => ingestStore(store))
  );

  const summary = results.map((r, i) => ({
    store_id: stores[i].store_id,
    ...(r.status === 'fulfilled' ? r.value : { status: 'error', error: r.reason?.message }),
  }));

  return res.status(200).json({ stores: summary });
}

// ─── Per-store ingest ─────────────────────────────────────────────────────────

async function ingestStore(store) {
  const { store_id, service_id, bearer_token } = store;

  const now = new Date();
  const start = new Date(now.getTime() - LOOKBACK_MINUTES * 60 * 1000);

  const startPeriod = start.toISOString();
  const endPeriod = now.toISOString();

  let token = bearer_token;
  let upserted = 0;
  let page = 0;

  try {
    while (true) {
      const url = buildUrl(service_id, startPeriod, endPeriod, page * LIMIT_PER_REQUEST);
      const data = await fetchWithRetry(url, token, store_id);

      if (!data.transactions?.length) break;

      upserted += await upsertTransactions(store_id, data.transactions);

      // If we got fewer than the limit, we've fetched all pages
      if (data.transactions.length < LIMIT_PER_REQUEST) break;
      page++;

      // Safety: max 10 pages per run to avoid runaway loops
      if (page >= 10) break;
    }

    return { status: 'ok', upserted, pages: page + 1 };
  } catch (err) {
    console.error(`[ingest] store ${store_id}:`, err.message);
    return { status: 'error', error: err.message, upserted };
  }
}

// ─── PDRS API call with 401 retry ────────────────────────────────────────────

async function fetchWithRetry(url, token, storeId) {
  const res = await fetchPDRS(url, token);

  if (res.status === 401) {
    // Token expired mid-run — refresh and retry once
    console.warn(`[ingest] store ${storeId}: 401, refreshing token...`);
    const newToken = await refreshTokenForStore(storeId);
    const retry = await fetchPDRS(url, newToken);
    if (!retry.ok) throw new Error(`PDRS API error after token refresh: ${retry.status}`);
    return retry.json();
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PDRS API error ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json();
}

async function fetchPDRS(url, token) {
  return fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'User-Agent': 'CStoreBackoffice/1.0',
    },
  });
}

function buildUrl(serviceId, startPeriod, endPeriod, offset = 0) {
  const params = new URLSearchParams({
    service_id: serviceId,
    sort_by: 'objectId:DSC',
    start_period: startPeriod,
    end_period: endPeriod,
    limit: String(LIMIT_PER_REQUEST),
    ...(offset > 0 ? { offset: String(offset) } : {}),
  });
  return `${PDRS_BASE}?${params}`;
}

// ─── Neon upsert ─────────────────────────────────────────────────────────────

async function upsertTransactions(storeId, transactions) {
  if (!transactions.length) return 0;

  let count = 0;
  for (const txn of transactions) {
    const {
      id,
      transDate,
      serviceId,
      storeNumber,
      type,
      transType,
      amountWTax,
      amountCurr,
      amountVal,
      text,
      department = [],
      mop = [],
      siteTimestamp,
    } = txn;

    // Upsert main transaction
    const result = await query(
      `INSERT INTO transactions
         (id, store_id, trans_date, service_id, store_number, type,
          trans_type, amount_w_tax, amount_curr, amount_val, text,
          site_timestamp, raw_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO UPDATE
         SET amount_w_tax   = EXCLUDED.amount_w_tax,
             amount_curr    = EXCLUDED.amount_curr,
             amount_val     = EXCLUDED.amount_val,
             updated_at     = NOW()
       RETURNING (xmax = 0) AS inserted`,
      [
        id,
        storeId,
        transDate,
        serviceId,
        storeNumber,
        type,
        transType,
        amountWTax,
        amountCurr,
        amountVal,
        text,
        siteTimestamp,
        JSON.stringify(txn),
      ]
    );

    const wasInserted = result.rows[0]?.inserted;
    if (wasInserted) count++;

    // Upsert transaction items (departments)
    if (department.length && wasInserted) {
      for (let i = 0; i < department.length; i++) {
        await query(
          `INSERT INTO transaction_items (transaction_id, store_id, department, sequence)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [id, storeId, department[i], i]
        ).catch(() => {}); // ignore if table doesn't have right schema yet
      }
    }
  }

  return count;
}
