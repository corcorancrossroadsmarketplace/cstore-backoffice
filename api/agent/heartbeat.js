// api/agent/heartbeat.js
// POST /api/agent/heartbeat
// Lightweight ping from the agent — just keeps the store showing as "online"

import { getDb, setCors } from '../_lib/db.js'

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const apiKey = req.headers['x-api-key'] || req.headers['X-Api-Key']
  if (!apiKey) return res.status(401).json({ error: 'API key required' })

  try {
    const sql = getDb()

    const stores = await sql`
      SELECT id FROM stores
      WHERE agent_api_key = ${apiKey} AND is_active = true LIMIT 1
    `
    if (stores.length === 0) return res.status(401).json({ error: 'Invalid API key' })

    const { agent_version, commander_ip } = req.body || {}

    await sql`
      INSERT INTO agent_heartbeats (store_id, last_seen, agent_version, commander_ip)
      VALUES (${stores[0].id}, NOW(), ${agent_version || null}, ${commander_ip || null})
      ON CONFLICT (store_id)
      DO UPDATE SET last_seen = NOW(),
        agent_version = COALESCE(EXCLUDED.agent_version, agent_heartbeats.agent_version),
        commander_ip  = COALESCE(EXCLUDED.commander_ip,  agent_heartbeats.commander_ip)
    `

    return res.status(200).json({ status: 'ok', time: new Date().toISOString() })
  } catch (err) {
    console.error('Heartbeat error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
