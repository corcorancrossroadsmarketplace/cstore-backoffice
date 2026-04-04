import { format } from 'date-fns'
import styles from './TransactionDetail.module.css'

export default function TransactionDetail({ transaction: txn, onClose }) {
  const fmt = (n) => Number(n || 0).toLocaleString('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2
  })
  const fmtTime = format(new Date(txn.transaction_time), 'MMM d, yyyy hh:mm:ss a')
  const isVoid = txn.is_voided || txn.transaction_type === 'VOID'

  return (
    <aside className={styles.panel}>
      {/* Header */}
      <div className={styles.panelHeader}>
        <div className={styles.panelTitle}>
          <span>Transaction Detail</span>
          {isVoid && <span className="badge badge-red">VOIDED</span>}
        </div>
        <button className={styles.closeBtn} onClick={onClose}>✕</button>
      </div>

      <div className={styles.scroll}>
        {/* Transaction meta */}
        <div className={styles.metaGrid}>
          <MetaRow label="Transaction #" value={`#${txn.transaction_id}`} mono />
          <MetaRow label="Time" value={fmtTime} />
          <MetaRow label="Register" value={`Register ${txn.register_id || '—'}`} />
          <MetaRow label="Cashier" value={txn.cashier_id || '—'} />
          <MetaRow label="Shift" value={txn.shift_number || '—'} />
          <MetaRow label="Business Date" value={txn.business_date} />
        </div>

        {/* Line items */}
        {txn.items && txn.items.length > 0 && (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Items</div>
            <div className={styles.itemList}>
              {txn.items.map((item, i) => (
                <div
                  key={i}
                  className={`${styles.itemRow} ${item.is_voided ? styles.itemVoided : ''}`}
                >
                  <div className={styles.itemLeft}>
                    <span className={styles.itemDesc}>
                      {item.is_voided && <span className={styles.voidTag}>VOID </span>}
                      {item.description || item.upc || 'Unknown Item'}
                    </span>
                    {item.is_fuel ? (
                      <span className={styles.itemSub}>
                        {item.fuel_grade} · {Number(item.fuel_gallons || 0).toFixed(3)} gal
                        @ {fmt(item.fuel_price_per_gallon)}/gal
                      </span>
                    ) : (
                      <span className={styles.itemSub}>
                        {item.upc && `UPC: ${item.upc} · `}
                        Qty: {item.quantity}
                        {item.department && ` · ${item.department}`}
                      </span>
                    )}
                  </div>
                  <span className={`${styles.itemPrice} mono`}>
                    {item.is_voided
                      ? <s>{fmt(item.extended_price)}</s>
                      : fmt(item.extended_price)
                    }
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Totals */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Totals</div>
          <div className={styles.totals}>
            <TotalRow label="Subtotal" value={fmt(txn.subtotal)} />
            <TotalRow label="Tax" value={fmt(txn.tax)} />
            <TotalRow
              label="Total"
              value={fmt(txn.total_amount)}
              highlight
              voided={isVoid}
            />
            <div className={styles.totalDivider} />
            <TotalRow
              label={`Tendered (${txn.tender_type || 'CASH'})`}
              value={fmt(txn.tender_amount)}
            />
            {txn.change_amount > 0 && (
              <TotalRow label="Change" value={fmt(txn.change_amount)} />
            )}
          </div>
        </div>

        {/* Alert if voided */}
        {isVoid && (
          <div className={styles.voidAlert}>
            ⚠ This transaction has been voided
          </div>
        )}
      </div>
    </aside>
  )
}

function MetaRow({ label, value, mono }) {
  return (
    <div className={styles.metaRow}>
      <span className={styles.metaLabel}>{label}</span>
      <span className={`${styles.metaValue} ${mono ? 'mono' : ''}`}>{value}</span>
    </div>
  )
}

function TotalRow({ label, value, highlight, voided }) {
  return (
    <div className={`${styles.totalRow} ${highlight ? styles.totalHighlight : ''}`}>
      <span className={styles.totalLabel}>{label}</span>
      <span className={`${styles.totalValue} mono`}
        style={voided ? { color: 'var(--red)' } : {}}>
        {voided ? <s>{value}</s> : value}
      </span>
    </div>
  )
}
