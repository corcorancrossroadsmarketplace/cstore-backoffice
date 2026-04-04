// api/stores/index.js
// GET /api/stores  →  Returns stores for the logged-in user + online status

import { getDb, requireAuth, setCors } from '../_lib/db.js'

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  const user = await requireAuth(req, res)
  if (!user) return

  try {
    const sql = getDb()

    // Get stores based on user role
    let stores
    if (user.role === 'owner') {
      stores = await sql`
        SELECT
          s.id, s.name, s.address, s.city, s.state, s.is_active,
          s.created_at,
          ah.last_seen,
          ah.agent_version,
          ah.commander_ip,
          CASE
            WHEN ah.last_seen > NOW() - INTERVAL '2 minutes' THEN true
            ELSE false
          END AS agent_online
        FROM stores s
        LEFT JOIN agent_heartbeats ah ON ah.store_id = s.id
        WHERE s.is_active = true
        ORDER BY s.name
      `
    } else {
      stores = await sql`
        SELECT
          s.id, s.name, s.address, s.city, s.state, s.is_active,
          s.created_at,
          ah.last_seen,
          ah.agent_version,
          ah.commander_ip,
          CASE
            WHEN ah.last_seen > NOW() - INTERVAL '2 minutes' THEN true
            ELSE false
          END AS agent_online
        FROM stores s
        JOIN user_store_access usa ON usa.store_id = s.id
        LEFT JOIN agent_heartbeats ah ON ah.store_id = s.id
        WHERE usa.user_id = ${user.id} AND s.is_active = true
        ORDER BY s.name
      `
    }

    return res.status(200).json({ stores })
  } catch (err) {
    console.error('Stores error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
