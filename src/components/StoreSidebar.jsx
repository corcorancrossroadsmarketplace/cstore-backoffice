import styles from './StoreSidebar.module.css'

export default function StoreSidebar({ stores, selectedStore, storeStatus, onSelect }) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        <span className={styles.title}>Locations</span>
        <span className={styles.count}>{stores.length}</span>
      </div>

      <nav className={styles.nav}>
        {stores.map(store => {
          const isOnline = storeStatus[store.id] === 'online'
          const isSelected = selectedStore?.id === store.id

          return (
            <button
              key={store.id}
              className={`${styles.storeBtn} ${isSelected ? styles.selected : ''}`}
              onClick={() => onSelect(store)}
            >
              <div className={styles.storeIcon}>
                {store.name.charAt(0)}
              </div>
              <div className={styles.storeInfo}>
                <span className={styles.storeName}>{store.name}</span>
                <span className={styles.storeAddr}>{store.city || store.address || '—'}</span>
              </div>
              <span className={`${styles.statusDot} ${isOnline ? styles.online : styles.offline}`} />
            </button>
          )
        })}
      </nav>

      <div className={styles.footer}>
        <div className={styles.legend}>
          <span className={`${styles.dot} ${styles.dotOnline}`} /> Online
        </div>
        <div className={styles.legend}>
          <span className={`${styles.dot} ${styles.dotOffline}`} /> Offline
        </div>
      </div>
    </aside>
  )
}
