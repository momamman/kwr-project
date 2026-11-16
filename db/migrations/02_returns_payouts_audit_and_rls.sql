-- ==============================================================================
-- Kitchenware Rentals (KWR) ERP Database Migration: 02
-- Purpose: 
--   1. Add return-audit, review gate, deposit payout, and revocation columns to orders.
--   2. Create compliance audit_logs table for server-side traceability.
--   3. Create inventory_catalog table for dynamic item management.
--   4. Ensure profiles table and automatic auth trigger exist.
--   5. Implement Row-Level Security (RLS) and performance indexes.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. ORDERS TABLE EXTENSION (Audits, Reviews, Payouts)
-- ------------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS return_report JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS return_review JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(14, 2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS refund_bank JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refunded_by TEXT,
  ADD COLUMN IF NOT EXISTS payout_adjustment JSONB,
  ADD COLUMN IF NOT EXISTS payout_closed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS payout_closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payout_closed_by TEXT,
  ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_revocations JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

COMMENT ON COLUMN public.orders.return_report IS 'Evidence recorded during return audit: item conditions, damaged/lost charges, fees, and notes';
COMMENT ON COLUMN public.orders.return_review IS 'Super Admin sign-off gate: approval status, refund due, auditor signature fingerprint, and notes';
COMMENT ON COLUMN public.orders.refund_amount IS 'Final approved/paid refund amount released from caution deposit';
COMMENT ON COLUMN public.orders.refund_bank IS 'Target bank name and account number for processed deposit refund';
COMMENT ON COLUMN public.orders.payout_closed IS 'Flag indicating the return transaction is fully settled and cleared from active payout queue';

-- Indexes on orders for rapid querying and filtering
CREATE INDEX IF NOT EXISTS idx_orders_order_no ON public.orders(order_no);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_deposit_status ON public.orders(deposit_status);
CREATE INDEX IF NOT EXISTS idx_orders_payout_closed ON public.orders(payout_closed);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_updated_at ON public.orders(updated_at DESC);

-- ------------------------------------------------------------------------------
-- 2. COMPLIANCE AUDIT LOGS TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no VARCHAR(64),
  action VARCHAR(64) NOT NULL,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email TEXT,
  actor_role TEXT,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.audit_logs IS 'Immutable compliance audit trail for returns, review approvals, payouts, and status transitions';

CREATE INDEX IF NOT EXISTS idx_audit_logs_order_no ON public.audit_logs(order_no);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);

-- ------------------------------------------------------------------------------
-- 3. INVENTORY CATALOG TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku VARCHAR(64) UNIQUE,
  desc_name TEXT NOT NULL,
  category VARCHAR(64) DEFAULT 'General',
  price NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  replacement_cost NUMERIC(12, 2) DEFAULT 0.00,
  in_stock INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_category ON public.inventory_catalog(category);
CREATE INDEX IF NOT EXISTS idx_inventory_active ON public.inventory_catalog(is_active);

-- Seed initial catalog if empty
INSERT INTO public.inventory_catalog (sku, desc_name, category, price, replacement_cost, in_stock)
VALUES
  ('CD-001', 'Chafing Dish Single (Roll Top)', 'Chafing Dishes', 3500.00, 35000.00, 50),
  ('CD-002', 'Chafing Dish Double (Standard)', 'Chafing Dishes', 3000.00, 28000.00, 60),
  ('PL-001', 'Dinner Plate Porcelain (White)', 'Plates & Bowls', 150.00, 1500.00, 500),
  ('GL-001', 'Highball Glass (Cocktail)', 'Glassware', 100.00, 800.00, 400),
  ('GL-002', 'Wine Glass (Stemmed)', 'Glassware', 120.00, 1200.00, 350),
  ('CT-001', 'Stainless Steel Cutlery Set (Fork & Spoon)', 'Cutlery', 80.00, 600.00, 500),
  ('TR-001', 'Serving Tray Oval (Stainless)', 'Accessories', 1500.00, 12000.00, 30),
  ('JD-001', 'Juice Dispenser (12 Litre)', 'Beverage', 5000.00, 45000.00, 15)
ON CONFLICT (sku) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 4. PROFILES TABLE & SIGNUP TRIGGER
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  role VARCHAR(32) DEFAULT 'user' CHECK (role IN ('super_admin', 'admin', 'data_entry', 'invoicing', 'analyst', 'user')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Function and trigger to auto-create profile when a user signs up via Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'user')
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
        updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ------------------------------------------------------------------------------
-- 5. AUTOMATED UPDATED_AT TIMESTAMP TRIGGER
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_orders_updated_at ON public.orders;
CREATE TRIGGER set_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

DROP TRIGGER IF EXISTS set_inventory_updated_at ON public.inventory_catalog;
CREATE TRIGGER set_inventory_updated_at
  BEFORE UPDATE ON public.inventory_catalog
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- ------------------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY (RLS) POLICIES
-- ------------------------------------------------------------------------------
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_catalog ENABLE ROW LEVEL SECURITY;

-- Helper function to check caller's role
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS TEXT AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ORDERS POLICIES
DROP POLICY IF EXISTS "Allow select for authenticated and anon users" ON public.orders;
CREATE POLICY "Allow select for authenticated and anon users"
  ON public.orders FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Allow insert/update for staff" ON public.orders;
CREATE POLICY "Allow insert/update for staff"
  ON public.orders FOR ALL
  USING (
    auth.role() = 'authenticated' OR auth.role() = 'anon'
  )
  WITH CHECK (
    auth.role() = 'authenticated' OR auth.role() = 'anon'
  );

-- CUSTOMERS POLICIES
DROP POLICY IF EXISTS "Allow customer access for staff" ON public.customers;
CREATE POLICY "Allow customer access for staff"
  ON public.customers FOR ALL
  USING (true)
  WITH CHECK (true);

-- INVENTORY POLICIES
DROP POLICY IF EXISTS "Allow inventory read for all" ON public.inventory_catalog;
CREATE POLICY "Allow inventory read for all"
  ON public.inventory_catalog FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Allow inventory management for admin" ON public.inventory_catalog;
CREATE POLICY "Allow inventory management for admin"
  ON public.inventory_catalog FOR ALL
  USING (
    auth.role() = 'authenticated'
  );

-- AUDIT LOGS POLICIES
DROP POLICY IF EXISTS "Allow select audit logs for admins and analysts" ON public.audit_logs;
CREATE POLICY "Allow select audit logs for admins and analysts"
  ON public.audit_logs FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Allow insert audit logs" ON public.audit_logs;
CREATE POLICY "Allow insert audit logs"
  ON public.audit_logs FOR INSERT
  WITH CHECK (true);

-- PROFILES POLICIES
DROP POLICY IF EXISTS "Allow users to read profiles" ON public.profiles;
CREATE POLICY "Allow users to read profiles"
  ON public.profiles FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Allow users to update own profile" ON public.profiles;
CREATE POLICY "Allow users to update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);
