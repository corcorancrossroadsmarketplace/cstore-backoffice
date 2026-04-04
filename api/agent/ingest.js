// api/agent/ingest.js
// POST /api/agent/ingest
// Called by the Python agent running on the store's back office PC.
// Accepts a batch of transactions parsed from Commander XML files.

import { getDb, setCors } from '../_lib/db.js'

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Agent authenticates with the store's API key
  const apiKey = req.headers['x-api-key'] || req.headers['X-Api-Key']
  if (!apiKey) return res.status(401).json({ error: 'API key required' })

  try {
    const sql = getDb()

    // Look up store by API key
    const stores = await sql`
      SELECT id, name FROM stores
      WHERE agent_api_key = ${apiKey} AND is_active = true
      LIMIT 1
    `
    if (stores.length === 0) {
      return res.status(401).json({ error: 'Invalid API key' })
    }
    const store = stores[0]

    const { transactions = [], agent_version, commander_ip } = req.body || {}

    // Update heartbeat
    await sql`
      INSERT INTO agent_heartbeats (store_id, last_seen, agent_version, commander_ip)
      VALUES (${store.id}, NOW(), ${agent_version || null}, ${commander_ip || null})
      ON CONFLICT (store_id)
      DO UPDATE SET
        last_seen = NOW(),
        agent_version = EXCLUDED.agent_version,
        commander_ip = EXCLUDED.commander_ip
    `

    if (transactions.length === 0) {
      return res.status(200).json({ received: 0, message: 'Heartbeat OK' })
    }

    let inserted = 0
    let skipped = 0

    for (const txn of transactions) {
      try {
        // Insert transaction (skip if duplicate)
        const [inserted_txn] = await sql`
          INSERT INTO transactions (
            store_id, transaction_id, register_id, cashier_id,
            transaction_type, subtotal, tax, total_amount, change_amount,
            tender_type, tender_amount, transaction_time, business_date,
            shift_number, is_voided
          ) VALUES (
            ${store.id},
            ${txn.transaction_id},
            ${txn.register_id || null},
            ${txn.cashier_id || null},
            ${txn.transaction_type || 'SALE'},
            ${parseFloat(txn.subtotal) || 0},
            ${parseFloat(txn.tax) || 0},
            ${parseFloat(txn.total_amount) || 0},
            ${parseFloat(txn.change_amount) || 0},
            ${txn.tender_type || null},
            ${parseFloat(txn.tender_amount) || 0},
            ${txn.transaction_time},
            ${txn.business_date},
            ${txn.shift_number || null},
            ${txn.is_voided || false}
          )
          ON CONFLICT (store_id, transaction_id, business_date)
          DO UPDATE SET
            is_voided = EXCLUDED.is_voided,
            transaction_type = EXCLUDED.transaction_type
          RETURNING id
        `

        // Insert line items (only for new transactions)
        if (inserted_txn && txn.items?.length > 0) {
          for (const item of txn.items) {
            await sql`
              INSERT INTO transaction_items (
                transaction_id, line_number, upc, description, quantity,
                unit_price, extended_price, department, category,
                is_voided, is_fuel, fuel_grade, fuel_gallons, fuel_price_per_gallon
              ) VALUES (
                ${inserted_txn.id},
                ${item.line_number || null},
                ${item.upc || null},
                ${item.description || null},
                ${parseFloat(item.quantity) || 1},
                ${parseFloat(item.unit_price) || null},
                ${parseFloat(item.extended_price) || 0},
                ${item.department || null},
                ${item.category || null},
                ${item.is_voided || false},
                ${item.is_fuel || false},
                ${item.fuel_grade || null},
                ${parseFloat(item.fuel_gallons) || null},
                ${parseFloat(item.fuel_price_per_gallon) || null}
              )
              ON CONFLICT DO NOTHING
            `
          }
        }
        inserted++
      } catch (txnErr) {
        // Log but don't fail the whole batch
        console.error('Error inserting transaction:', txn.transaction_id, txnErr.message)
        skipped++
      }
    }

    return res.status(200).json({
      message: 'OK',
      received: transactions.length,
      inserted,
      skipped
    })
  } catch (err) {
    console.error('Ingest error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
