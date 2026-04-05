// api/cron/refresh-tokens.js
// Vercel cron: runs every 45 minutes
// Finds stores with expiring/missing tokens and refreshes them
//
// vercel.json config:
//   { "path": "/api/cron/refresh-tokens", "schedule": "*/45 * * * *" }

import { getStoresNeedingRefresh } from '../_lib/tokenStore.js';
import { refreshTokenForStore } from '../auth/verifone.js';

export default async function handler(req, res) {
  // Vercel cron requests include this header for verification
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const stores = await getStoresNeedingRefresh();

  if (stores.length === 0) {
    return res.status(200).json({ message: 'All tokens valid, nothing to refresh' });
  }

  console.log(`[refresh-tokens] refreshing tokens for ${stores.length} store(s)`);

  const results = await Promise.allSettled(
    stores.map(async (store) => {
      try {
        await refreshTokenForStore(store.store_id);
        return { store_id: store.store_id, status: 'ok' };
      } catch (err) {
        console.error(`[refresh-tokens] store ${store.store_id} failed:`, err.message);
        return { store_id: store.store_id, status: 'error', error: err.message };
      }
    })
  );

  const summary = results.map((r) => r.value ?? r.reason);
  const errors = summary.filter((r) => r.status === 'error');

  return res.status(200).json({
    refreshed: summary.length,
    errors: errors.length,
    results: summary,
  });
}
