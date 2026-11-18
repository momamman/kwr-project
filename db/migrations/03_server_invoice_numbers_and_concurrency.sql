-- ==============================================================================
-- Kitchenware Rentals (KWR) ERP Database Migration: 03
-- Purpose:
-- 1. Allocate invoice / legacy reference numbers on the SERVER (fixes client-side
--    colliding numbers such as every browser starting at #INV-0005).
-- 2. Make order_no unique so a duplicate number can never silently UPDATE another
--    invoice (the "overwritten invoice" incident).
-- 3. Freeze order_no after insert so an edit can never renumber/re-key a row.
--
-- Safe to run more than once. Run this AFTER migration 02.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. SERVER-SIDE NUMBER SEQUENCES
-- ------------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.orders_invoice_seq AS BIGINT START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS public.orders_legacy_seq  AS BIGINT START WITH 1 INCREMENT BY 1;

-- Seed the invoice sequence from the highest numeric order_no already stored.
-- Accepts 0005, 5, INV-0005 and #INV-0005 so the first allocated number cannot
-- collide with an existing invoice.
SELECT setval(
  'public.orders_invoice_seq',
  GREATEST(
    COALESCE((
      SELECT MAX((regexp_replace(order_no, '\D', '', 'g'))::BIGINT)
      FROM public.orders
      WHERE order_no ~ '^#?(INV-)?[0-9]+$'
    ), 0) + 1,
    1
  ),
  false
);

-- Seed the legacy sequence from the highest LEG-#### reference already stored.
SELECT setval(
  'public.orders_legacy_seq',
  GREATEST(
    COALESCE((
      SELECT MAX((regexp_replace(order_no, '\D', '', 'g'))::BIGINT)
      FROM public.orders
      WHERE order_no ~ '^#?LEG-[0-9]+$'
    ), 0) + 1,
    1
  ),
  false
);

-- Returns a zero-padded invoice number WITHOUT the display prefix, e.g. '0006'.
-- The value is drawn from a sequence, so it is atomic and safe under concurrent
-- saves from multiple browsers/devices.
CREATE OR REPLACE FUNCTION public.next_invoice_no()
RETURNS TEXT
LANGUAGE sql
VOLATILE
AS $$
  SELECT lpad(nextval('public.orders_invoice_seq')::TEXT, 4, '0');
$$;

-- Returns a legacy reference number, e.g. 'LEG-0007'.
CREATE OR REPLACE FUNCTION public.next_legacy_no()
RETURNS TEXT
LANGUAGE sql
VOLATILE
AS $$
  SELECT 'LEG-' || lpad(nextval('public.orders_legacy_seq')::TEXT, 4, '0');
$$;

-- The client calls these through PostgREST (supabase.rpc). The functions only
-- consume sequences, so no table privileges are required.
GRANT USAGE  ON SEQUENCE public.orders_invoice_seq TO anon, authenticated;
GRANT USAGE  ON SEQUENCE public.orders_legacy_seq  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_invoice_no() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_legacy_no()  TO anon, authenticated;

COMMENT ON SEQUENCE public.orders_invoice_seq IS 'Allocates order_no for live invoices (#INV-####)';
COMMENT ON SEQUENCE public.orders_legacy_seq  IS 'Allocates order_no for legacy ingestions (#LEG-####)';
COMMENT ON FUNCTION public.next_invoice_no() IS 'Atomically allocates the next live invoice number (digits only)';
COMMENT ON FUNCTION public.next_legacy_no()  IS 'Atomically allocates the next legacy reference number';

-- ------------------------------------------------------------------------------
-- 2. UNIQUE order_no (the collision guard)
-- ------------------------------------------------------------------------------
-- Do not fail the whole migration if historical duplicates exist. The notice
-- tells the operator what to clean up; the JS layer refuses to overwrite either
-- way (it updates by id, never by order_no).
DO $$
DECLARE
  v_dupes BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_dupes
  FROM (
    SELECT order_no
    FROM public.orders
    WHERE order_no IS NOT NULL
    GROUP BY order_no
    HAVING COUNT(*) > 1
  ) d;

  IF v_dupes > 0 THEN
    RAISE NOTICE
      'Skipping unique index ux_orders_order_no: % order_no value(s) are duplicated. Run the duplicate report below, merge/split those rows, then re-run this migration.',
      v_dupes;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_order_no
      ON public.orders (order_no)
      WHERE order_no IS NOT NULL;
  END IF;
END
$$;

-- ------------------------------------------------------------------------------
-- 3. order_no IS IMMUTABLE AFTER INSERT
-- ------------------------------------------------------------------------------
-- A re-key is never a legitimate "edit"; it must be a new invoice. This trigger
-- stops accidental renumbering at the database level.
CREATE OR REPLACE FUNCTION public.prevent_order_no_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.order_no IS DISTINCT FROM OLD.order_no THEN
    RAISE EXCEPTION
      'order_no is immutable (attempted % -> %). Create a new invoice instead of re-keying an existing one.',
      OLD.order_no, NEW.order_no
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_order_no_immutable ON public.orders;
CREATE TRIGGER trg_orders_order_no_immutable
  BEFORE UPDATE OF order_no ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_order_no_change();

-- ------------------------------------------------------------------------------
-- 4. DIAGNOSTICS (read-only helper for operators)
-- ------------------------------------------------------------------------------
-- Run this to find numbers that collided before the unique index existed:
--
--   SELECT order_no,
--          COUNT(*)                         AS copies,
--          ARRAY_AGG(id ORDER BY created_at) AS order_ids,
--          MIN(created_at)                  AS first_seen,
--          MAX(updated_at)                  AS last_written
--   FROM public.orders
--   WHERE order_no IS NOT NULL
--   GROUP BY order_no
--   HAVING COUNT(*) > 1
--   ORDER BY copies DESC, order_no;
--
-- To restore an overwritten invoice, use Supabase PITR / backups, or the browser
-- print archive, then re-insert it with a fresh number from next_invoice_no().

COMMIT;
