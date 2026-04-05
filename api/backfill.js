// api/backfill.js
// One-shot backfill: pulls up to 7 days of transactions for a store
// POST /api/backfill  { store_id }
// Owner only — run once after first successful token is obtained

import { query } from './_lib/db.js';
import { getValidToken } from './_lib/tokenStore.js';
import { refreshTokenForStore } from './auth/verifone.js';
import { verifyToken } from './_lib/auth.js';

const PDRS_BASE = 'https://us.portal.gsc-petro.verifone.cloud/oidc/pdrs/v1/tlogs/transactions/financial';
const BACKFILL_DAYS = 7;
const LIMIT = 100;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const user = verifyToken(req);
  if (!user || user.role !== 'owner') {
    return res.status(403).json({ error: 'Owner access required' });
  }

  const { store_id } = req.body;
  if (!store_id) return res.status(400).json({ error: 'store_id required' });

  // Get store info
  const storeRes = await query('SELECT service_id FROM stores WHERE id=$1', [store_id]);
  if (!storeRes.rows.length) return res.status(404).json({ error: 'Store not found' });
  const { service_id } = storeRes.rows[0];

  // Ensure we have a valid token
  let token = await getValidToken(store_id);
  if (!token) {
    try {
      token = await refreshTokenForStore(store_id);
    } catch (err) {
      return res.status(500).json({ error: `Token refresh failed: ${err.message}` });
    }
  }

  const now = new Date();
  const start = new Date(now.getTime() - BACKFILL_DAYS * 24 * 60 * 60 * 1000);

  res.setHeader('Content-Type', 'application/json');

  let total = 0;
  let offset = 0;
  let pages = 0;

  try {
    while (true) {
      const params = new URLSearchParams({
        service_id,
        sort_by: 'objectId:DSC',
        start_period: start.toISOString(),
        end_period: now.toISOString(),
        limit: String(LIMIT),
        ...(offset > 0 ? { offset: String(offset) } : {}),
      });

      const apiRes = await fetch(`${PDRS_BASE}?${params}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });

      if (!apiRes.ok) {
        const text = await apiRes.text();
        return res.status(500).json({
          error: `PDRS API error ${apiRes.status}`,
          detail: text.slice(0, 200),
          upserted: total,
        });
      }

      const data = await apiRes.json();
      if (!data.transactions?.length) break;

      // Upsert batch
      for (const txn of data.transactions) {
        await query(
          `INSERT INTO transactions
             (id, store_id, trans_date, service_id, store_number, type,
              trans_type, amount_w_tax, amount_curr, amount_val, text,
              site_timestamp, raw_data)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (id) DO NOTHING`,
          [
            txn.id, store_id, txn.transDate, txn.serviceId, txn.storeNumber,
            txn.type, txn.transType, txn.amountWTax, txn.amountCurr,
            txn.amountVal, txn.text, txn.siteTimestamp, JSON.stringify(txn),
          ]
        ).catch(() => {});
        total++;
      }

      pages++;
      if (data.transactions.length < LIMIT) break;
      offset += LIMIT;

      // Safety cap: 7 days * ~2000 txns/day / 100 per page = ~140 pages max
      if (pages >= 200) break;
    }

    return res.status(200).json({
      success: true,
      upserted: total,
      pages,
      days: BACKFILL_DAYS,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message, upserted: total });
  }
}
