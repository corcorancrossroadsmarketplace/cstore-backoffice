import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../App.jsx'
import Header from '../components/Header.jsx'
import TransactionFeed from '../components/TransactionFeed.jsx'
import TransactionDetail from '../components/TransactionDetail.jsx'
import StoreSidebar from '../components/StoreSidebar.jsx'
import styles from './Dashboard.module.css'

const POLL_INTERVAL = 5000

export default function Dashboard() {
  const { user } = useAuth()
  const [stores, setStores] = useState([])
  const [selectedStore, setSelectedStore] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [selectedTxn, setSelectedTxn] = useState(null)
  const [storeStatus, setStoreStatus] = useState({})
  const [stats, setStats] = useState(null)
  const [loadingTxns, setLoadingTxns] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [dateFilter, setDateFilter] = useState('today')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  useEffect(() => {
    fetch('/api/stores', { headers: { Authorization: `Bearer ${user.token}` } })
      .then(r => r.json())
      .then(data => {
        setStores(data.stores || [])
        if (data.stores?.length > 0) setSelectedStore(data.stores[0])
        const statusMap = {}
        data.stores?.forEach(s => { statusMap[s.id] = s.agent_online ? 'online' : 'offline' })
        setStoreStatus(statusMap)
      })
      .catch(console.error)
  }, [user.token])

  const fetchTransactions = useCallback(async (storeId, isBackground = false) => {
    if (!storeId) return
    if (!isBackground) setLoadingTxns(true)
    try {
      let url = `/api/transactions?store_id=${storeId}&limit=100`
      if (dateFilter === 'custom' && dateFrom && dateTo) {
        url += `&date_from=${dateFrom}&date_to=${dateTo}`
      } else {
        url += `&date_filter=${dateFilter}`
      }
      const res = await fetch(url, { headers: { Authorization: `Bearer ${user.token}` } })
      const data = await res.json()
      setTransactions(prev => {
        const existingIds = new Set(prev.map(t => t.id))
        const newOnes = (data.transactions || []).filter(t => !existingIds.has(t.id))
        if (newOnes.length > 0) return [...newOnes, ...prev].slice(0, 200)
        return data.transactions || prev
      })
      setStats(data.stats || null)
      setLastUpdated(new Date())
      if (data.agent_status) setStoreStatus(prev => ({ ...prev, [storeId]: data.agent_status }))
    } catch {}
    finally { if (!isBackground) setLoadingTxns(false) }
  }, [user.token, dateFilter, dateFrom, dateTo])

  useEffect(() => {
    if (!selectedStore) return
    setTransactions([])
    setSelectedTxn(null)
    fetchTransactions(selectedStore.id, false)
    const interval = setInterval(() => {
      if (dateFilter === 'today') fetchTransactions(selectedStore.id, true)
    }, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [selectedStore, fetchTransactions, dateFilter])

  const fuelGrades = stats?.fuel_grades || []
  const totalGallons = fuelGrades.reduce((sum, g) => sum + (parseFloat(g.gallons) || 0), 0)

  return (
    <div className={styles.layout}>
      <Header user={user} lastUpdated={lastUpdated} selectedStore={selectedStore} storeStatus={storeStatus} />
      <div className={styles.body}>
        <StoreSidebar stores={stores} selectedStore={selectedStore} storeStatus={storeStatus} onSelect={store => setSelectedStore(store)} />
        <main className={styles.main}>
          {selectedStore ? (
            <>
              {/* Date filter toolbar */}
              <div className={styles.toolbar}>
                <span className={styles.toolbarLabel}>Date:</span>
                {['today','yesterday','last7','last30'].map(f => (
                  <button
                    key={f}
                    className={`${styles.filterBtn} ${dateFilter === f ? styles.filterActive : ''}`}
                    onClick={() => setDateFilter(f)}
                  >
                    {{ today:'Today', yesterday:'Yesterday', last7:'Last 7 days', last30:'Last 30 days' }[f]}
                  </button>
                ))}
                <button
                  className={`${styles.filterBtn} ${dateFilter === 'custom' ? styles.filterActive : ''}`}
                  onClick={() => setDateFilter('custom')}
                >Custom range</button>
                {dateFilter === 'custom' && (
                  <div className={styles.customRange}>
                    <input type="date" className={styles.dateInput} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
                    <span className={styles.dateSep}>→</span>
                    <input type="date" className={styles.dateInput} value={dateTo} onChange={e => setDateTo(e.target.value)} />
                    <button className={styles.applyBtn} onClick={() => fetchTransactions(selectedStore.id, false)}>Apply</button>
                  </div>
                )}
              </div>

              {/* Stats bar */}
              {stats && (
                <div className={styles.statsBar}>
                  <StatCard label="Sales" value={fmt(stats.total_sales_today)} color="green" />
                  <StatCard label="Transactions" value={(stats.txn_count_today||0).toLocaleString()} color="blue" />
                  <StatCard label="Avg Ticket" value={fmt(stats.avg_ticket_today)} color="blue" />
                  <StatCard label="Total Gallons" value={totalGallons.toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1})} color="orange" />
                  <StatCard label="Voids" value={(stats.void_count_today||0).toString()} color={stats.void_count_today > 0 ? 'red' : 'muted'} />
                  <StatCard label="No Sales" value={(stats.no_sale_count_today||0).toString()} color={stats.no_sale_count_today > 0 ? 'yellow' : 'muted'} />
                </div>
              )}

              {/* Fuel strip */}
              {fuelGrades.length > 0 && (
                <div className={styles.fuelSection}>
                  <div className={styles.fuelHeader}>
                    <span className={styles.fuelLiveDot} />
                    <span className={styles.fuelTitle}>Gallons pumped — live</span>
                  </div>
                  <div className={styles.fuelStrip}>
                    {fuelGrades.map((g, i) => (
                      <div key={i} className={styles.fuelGrade}>
                        <div className={styles.fuelGradeName}>{g.grade}</div>
                        <div className={styles.fuelGallons}>{Number(g.gallons||0).toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1})}</div>
                        <div className={styles.fuelAmount}>{fmt(g.amount)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <TransactionFeed
                transactions={transactions}
                loading={loadingTxns}
                selectedId={selectedTxn?.id}
                onSelect={setSelectedTxn}
              />
            </>
          ) : (
            <div className={styles.empty}><p>Select a store to view live transactions</p></div>
          )}
        </main>
        {selectedTxn && <TransactionDetail transaction={selectedTxn} onClose={() => setSelectedTxn(null)} />}
      </div>
    </div>
  )
}

const fmt = (n) => Number(n||0).toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2})

function StatCard({ label, value, color }) {
  const colors = { green:'var(--green)', blue:'var(--blue)', red:'var(--red)', yellow:'var(--yellow)', orange:'var(--orange)', muted:'var(--text-secondary)' }
  return (
    <div className={styles.statCard}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue} style={{ color: colors[color] }}>{value}</span>
    </div>
  )
}
