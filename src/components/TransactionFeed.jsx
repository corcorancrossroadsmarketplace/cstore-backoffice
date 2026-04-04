import { format } from 'date-fns'
import styles from './TransactionFeed.module.css'

const TYPE_CONFIG = {
  SALE:      { label: 'Sale',      color: 'green',  icon: '↑' },
  VOID:      { label: 'Void',      color: 'red',    icon: '✕' },
  REFUND:    { label: 'Refund',    color: 'yellow', icon: '↩' },
  NO_SALE:   { label: 'No Sale',   color: 'yellow', icon: '○' },
  FUEL_ONLY: { label: 'Fuel',      color: 'orange', icon: '⛽' },
}

const TENDER_ICONS = {
  CASH:   '💵',
  CREDIT: '💳',
  DEBIT:  '💳',
  EBT:    '🏛',
  FLEET:  '🚚',
}

export default function TransactionFeed({ transactions, loading, selectedId, onSelect }) {
  if (loading && transactions.length === 0) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <span>Loading transactions...</span>
      </div>
    )
  }

  if (!loading && transactions.length === 0) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyIcon}>📋</div>
        <div className={styles.emptyTitle}>No transactions yet</div>
        <div className={styles.emptyMsg}>
          Transactions will appear here once the agent connects to your Commander.
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      {/* Column headers */}
      <div className={styles.colHeaders}>
        <span className={styles.colTime}>Time</span>
        <span className={styles.colType}>Type</span>
        <span className={styles.colId}>Txn #</span>
        <span className={styles.colReg}>Register</span>
        <span className={styles.colCashier}>Cashier</span>
        <span className={styles.colTender}>Tender</span>
        <span className={styles.colAmount}>Total</span>
      </div>

      {/* Transaction rows */}
      <div className={styles.list}>
        {transactions.map((txn, idx) => (
          <TransactionRow
            key={txn.id}
            txn={txn}
            isNew={idx === 0}
            isSelected={selectedId === txn.id}
            onClick={() => onSelect(txn)}
          />
        ))}
      </div>
    </div>
  )
}

function TransactionRow({ txn, isNew, isSelected, onClick }) {
  const cfg = TYPE_CONFIG[txn.transaction_type] || TYPE_CONFIG.SALE
  const time = new Date(txn.transaction_time)
  const fmtTime = format(time, 'hh:mm:ss a')
  const fmtAmount = Number(txn.total_amount || 0).toLocaleString('en-US', {
    style: 'currency', currency: 'USD'
  })
  const tenderIcon = TENDER_ICONS[txn.tender_type] || '💰'
  const isVoid = txn.is_voided || txn.transaction_type === 'VOID'

  return (
    <div
      className={`
        ${styles.row}
        ${isSelected ? styles.selected : ''}
        ${isNew ? 'slide-down' : ''}
        ${isVoid ? styles.voided : ''}
      `}
      onClick={onClick}
    >
      <span className={`${styles.cell} ${styles.cellTime} mono`}>{fmtTime}</span>

      <span className={`${styles.cell} ${styles.cellType}`}>
        <span className={`badge badge-${cfg.color}`}>
          {cfg.icon} {cfg.label}
        </span>
      </span>

      <span className={`${styles.cell} ${styles.cellId} mono`}>
        #{txn.transaction_id}
      </span>

      <span className={`${styles.cell} ${styles.cellReg}`}>
        Reg {txn.register_id || '—'}
      </span>

      <span className={`${styles.cell} ${styles.cellCashier}`}>
        {txn.cashier_id || '—'}
      </span>

      <span className={`${styles.cell} ${styles.cellTender}`}>
        {txn.tender_type ? (
          <span className={styles.tender}>
            <span>{tenderIcon}</span>
            <span>{txn.tender_type}</span>
          </span>
        ) : '—'}
      </span>

      <span className={`${styles.cell} ${styles.cellAmount} mono`}
        style={{ color: isVoid ? 'var(--red)' : 'var(--green)' }}>
        {isVoid ? <s>{fmtAmount}</s> : fmtAmount}
      </span>
    </div>
  )
}
