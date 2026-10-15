-- ==============================================================================
-- Kitchenware Rentals (KWR) ERP Database Migration
-- Purpose: Add column to orders table to differentiate legacy orders from new orders
-- ==============================================================================

-- 1. Add is_legacy boolean column (default false for live system orders)
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS is_legacy BOOLEAN DEFAULT FALSE;

-- 2. Add order_type column for explicit categorization ('new' vs 'legacy')
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS order_type VARCHAR(50) DEFAULT 'new';

-- 3. Document the columns
COMMENT ON COLUMN public.orders.is_legacy IS 'Differentiates historical backfilled orders (TRUE) from live system orders (FALSE)';
COMMENT ON COLUMN public.orders.order_type IS 'Category of order: "new" for standard app invoicing, "legacy" for ingested paper receipts';

-- 4. Create performance indexes for filtering legacy vs new transactions
CREATE INDEX IF NOT EXISTS idx_orders_is_legacy ON public.orders(is_legacy);
CREATE INDEX IF NOT EXISTS idx_orders_order_type ON public.orders(order_type);

-- 5. Backfill existing records:
-- If an order has [LEGACY] in notes or an order_no starting with LEG-, flag as legacy
UPDATE public.orders 
SET is_legacy = TRUE, order_type = 'legacy'
WHERE (notes ILIKE '%legacy%') OR (order_no ILIKE 'LEG-%');

-- Ensure all remaining records are flagged as 'new'
UPDATE public.orders 
SET is_legacy = FALSE, order_type = 'new'
WHERE is_legacy IS NULL;
