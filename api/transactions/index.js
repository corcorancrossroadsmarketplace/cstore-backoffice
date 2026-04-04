// api/transactions/index.js
// GET /api/transactions?store_id=X&limit=100&date_filter=today|yesterday|last7|last30
// GET /api/transactions?store_id=X&date_from=YYYY-MM-DD&date_to=YYYY-MM-DD

import { getDb, requireAuth, setCors } from '../_lib/db.js'

function getDateRange(filter) {
  const today = new Date()
  const pad = (d) => d.toISOString().split('T')[0]

  switch (filter) {
    case 'yesterday': {
      const y = new Date(today); y.setDate(y.getDate() - 1)
      return { from: pad(y), to: pad(y) }
    }
    case 'last7': {
      const w = new Date(today); w.setDate(w.getDate() - 6)
      return { from: pad(w), to: pad(today) }
    }
    case 'last30': {
      const m = new Date(today); m.setDate(m.getDate() - 29)
      return { from: pad(m), to: pad(today) }
    }
    default: // today
      return { from: pad(today), to: pad(today) }
  }
}

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const user = await requireAuth(req, res)
  if (!user) return

  const { store_id, limit = '100', date_filter = 'today', date_from, date_to } = req.query
  if (!store_id) return res.status(400).json({ error: 'store_id is required' })

  try {
    const sql = getDb()

    // Verify store access
    if (user.role !== 'owner') {
      const access = await sql`
        SELECT 1 FROM user_store_access
        WHERE user_id = ${user.id} AND store_id = ${store_id} LIMIT 1`
      if (access.length === 0) return res.status(403).json({ error: 'Access denied' })
    }

    const limitNum = Math.min(parseInt(limit) || 100, 500)
    const range = (date_from && date_to)
      ? { from: date_from, to: date_to }
      : getDateRange(date_filter)

    // Fetch transactions
    const transactions = await sql`
      SELECT
        t.id, t.transaction_id, t.register_id, t.cashier_id,
        t.transaction_type, t.subtotal, t.tax, t.total_amount,
        t.change_amount, t.tender_type, t.tender_amount,
        t.transaction_time, t.business_date, t.shift_number, t.is_voided
      FROM transactions t
      WHERE t.store_id = ${store_id}
        AND t.business_date BETWEEN ${range.from} AND ${range.to}
      ORDER BY t.transaction_time DESC
      LIMIT ${limitNum}`

    // Attach line items
    if (transactions.length > 0) {
      const txnIds = transactions.map(t => t.id)
      const items = await sql`
        SELECT * FROM transaction_items
        WHERE transaction_id = ANY(${txnIds})
        ORDER BY line_number ASC`
      const itemsByTxn = {}
      items.forEach(item => {
        if (!itemsByTxn[item.transaction_id]) itemsByTxn[item.transaction_id] = []
        itemsByTxn[item.transaction_id].push(item)
      })
      transactions.forEach(t => { t.items = itemsByTxn[t.id] || [] })
    }

    // Today's summary stats
    const today = new Date().toISOString().split('T')[0]
    const [stats] = await sql`
      SELECT
        COALESCE(SUM(CASE WHEN transaction_type = 'SALE' AND NOT is_voided THEN total_amount END), 0) AS total_sales_today,
        COUNT(CASE WHEN transaction_type = 'SALE' AND NOT is_voided THEN 1 END) AS txn_count_today,
        COALESCE(AVG(CASE WHEN transaction_type = 'SALE' AND NOT is_voided THEN total_amount END), 0) AS avg_ticket_today,
        COUNT(CASE WHEN transaction_type = 'VOID' OR is_voided THEN 1 END) AS void_count_today,
        COUNT(CASE WHEN transaction_type = 'NO_SALE' THEN 1 END) AS no_sale_count_today
      FROM transactions
      WHERE store_id = ${store_id} AND business_date = ${today}`

    // Fuel gallons by grade for today
    const fuelGrades = await sql`
      SELECT
        ti.fuel_grade AS grade,
        COALESCE(SUM(ti.fuel_gallons), 0) AS gallons,
        COALESCE(SUM(ti.extended_price), 0) AS amount
      FROM transaction_items ti
      JOIN transactions t ON t.id = ti.transaction_id
      WHERE t.store_id = ${store_id}
        AND t.business_date = ${today}
        AND ti.is_fuel = true
        AND ti.fuel_grade IS NOT NULL
        AND ti.fuel_grade != ''
      GROUP BY ti.fuel_grade
      ORDER BY SUM(ti.fuel_gallons) DESC`

    // Agent status
    const [heartbeat] = await sql`
      SELECT last_seen,
        CASE WHEN last_seen > NOW() - INTERVAL '2 minutes' THEN 'online' ELSE 'offline' END AS status
      FROM agent_heartbeats WHERE store_id = ${store_id}`

    return res.status(200).json({
      transactions,
      stats: { ...stats, fuel_grades: fuelGrades },
      agent_status: heartbeat?.status || 'offline',
      agent_last_seen: heartbeat?.last_seen || null,
      date_range: range
    })
  } catch (err) {
    console.error('Transactions error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
