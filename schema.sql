-- ============================================================
-- C-Store Back Office - Database Schema
-- Run this once in your Neon PostgreSQL dashboard
-- ============================================================

-- Users (owners and managers)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'manager', -- 'owner' | 'manager'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Stores
CREATE TABLE IF NOT EXISTS stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  address VARCHAR(500),
  city VARCHAR(100),
  state VARCHAR(50),
  agent_api_key VARCHAR(255) UNIQUE NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Links users to stores (owners see all, managers see their assigned store)
CREATE TABLE IF NOT EXISTS user_store_access (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, store_id)
);

-- Agent heartbeat (tracks when each store last connected)
CREATE TABLE IF NOT EXISTS agent_heartbeats (
  store_id UUID PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  last_seen TIMESTAMPTZ NOT NULL,
  agent_version VARCHAR(50),
  commander_ip VARCHAR(50)
);

-- Transactions pulled from Commander
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
  transaction_id VARCHAR(100) NOT NULL,
  register_id VARCHAR(50),
  cashier_id VARCHAR(50),
  transaction_type VARCHAR(50) NOT NULL, -- SALE | VOID | NO_SALE | REFUND | FUEL_ONLY
  subtotal DECIMAL(10,2) DEFAULT 0,
  tax DECIMAL(10,2) DEFAULT 0,
  total_amount DECIMAL(10,2) DEFAULT 0,
  change_amount DECIMAL(10,2) DEFAULT 0,
  tender_type VARCHAR(50),  -- CASH | CREDIT | DEBIT | EBT | etc.
  tender_amount DECIMAL(10,2) DEFAULT 0,
  transaction_time TIMESTAMPTZ NOT NULL,
  business_date DATE NOT NULL,
  shift_number INTEGER,
  is_voided BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, transaction_id, business_date)
);

-- Individual line items within a transaction
CREATE TABLE IF NOT EXISTS transaction_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID REFERENCES transactions(id) ON DELETE CASCADE,
  line_number INTEGER,
  upc VARCHAR(50),
  description VARCHAR(255),
  quantity DECIMAL(10,3) DEFAULT 1,
  unit_price DECIMAL(10,4),
  extended_price DECIMAL(10,2),
  department VARCHAR(100),
  category VARCHAR(100),
  is_voided BOOLEAN DEFAULT FALSE,
  is_fuel BOOLEAN DEFAULT FALSE,
  fuel_grade VARCHAR(50),
  fuel_gallons DECIMAL(10,4),
  fuel_price_per_gallon DECIMAL(10,4)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_transactions_store_time ON transactions(store_id, transaction_time DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_store_date ON transactions(store_id, business_date DESC);
CREATE INDEX IF NOT EXISTS idx_transaction_items_txn ON transaction_items(transaction_id);

-- ============================================================
-- Seed: Insert your 4 stores (update names/addresses)
-- ============================================================

INSERT INTO stores (name, address, city, state, agent_api_key) VALUES
  ('Store 1', '123 Main St', 'Your City', 'ST', 'STORE1-' || gen_random_uuid()),
  ('Store 2', '456 Oak Ave', 'Your City', 'ST', 'STORE2-' || gen_random_uuid()),
  ('Store 3', '789 Pine Rd', 'Your City', 'ST', 'STORE3-' || gen_random_uuid()),
  ('Store 4', '321 Elm Blvd', 'Your City', 'ST', 'STORE4-' || gen_random_uuid())
ON CONFLICT DO NOTHING;

-- After running, use this query to get your store API keys for the agents:
-- SELECT name, agent_api_key FROM stores;
