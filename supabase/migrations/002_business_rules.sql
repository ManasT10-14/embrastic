-- =============================================
-- EMBRASTIC — Business-rule hardening
--
-- Run this in the Supabase SQL Editor after 001_initial_schema.sql.
-- It is idempotent: re-running it is safe.
--
-- What it does:
--   1. Lets an order carry the approved quotation's discount and GST, so the
--      price a customer approved survives Quotation → Order → Invoice.
--   2. Adds CHECK constraints so quantities and percentages can't become
--      logically impossible (accepted > produced, completed > ordered, ...).
--   3. Makes stock movements atomic, so inventory_items.current_stock can
--      never drift away from inventory_transactions.
-- =============================================

-- ---------------------------------------------------------------------------
-- 1. Orders carry the approved price, not just quantity x rate
-- ---------------------------------------------------------------------------

alter table orders add column if not exists discount    numeric(12,2) not null default 0;
alter table orders add column if not exists gst_percent numeric(5,2)  not null default 18;

-- ---------------------------------------------------------------------------
-- 2. Business-rule constraints
--    Wrapped in DO blocks because Postgres has no
--    "ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS".
-- ---------------------------------------------------------------------------

do $$ begin
  alter table orders add constraint orders_amounts_sane
    check (quantity >= 0 and rate >= 0 and discount >= 0 and gst_percent >= 0 and gst_percent <= 100);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table quotations add constraint quotations_gst_sane
    check (gst_percent >= 0 and gst_percent <= 100);
exception when duplicate_object then null; end $$;

-- A production job can't complete, reject or rework more pieces than were
-- ordered into it. This is what stops "Ordered 10 / Completed 12".
do $$ begin
  alter table production_jobs add constraint production_quantities_sane
    check (
      quantity_ordered   >= 0 and
      quantity_completed >= 0 and
      quantity_rejected  >= 0 and
      quantity_rework    >= 0 and
      quantity_completed + quantity_rejected + quantity_rework <= quantity_ordered
    );
exception when duplicate_object then null; end $$;

-- QC can't account for more pieces than were actually produced.
-- This is what stops "Produced 10 / Accepted 15".
do $$ begin
  alter table qc_records add constraint qc_quantities_sane
    check (
      quantity_produced >= 0 and
      quantity_accepted >= 0 and
      quantity_rejected >= 0 and
      quantity_rework   >= 0 and
      quantity_accepted + quantity_rejected + quantity_rework <= quantity_produced
    );
exception when duplicate_object then null; end $$;

do $$ begin
  alter table invoices add constraint invoices_amounts_sane
    check (discount >= 0 and gst_percent >= 0 and gst_percent <= 100 and due_date >= invoice_date);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table expenses add constraint expenses_amounts_sane
    check (amount >= 0 and gst_percent >= 0 and gst_percent <= 100);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table inventory_items add constraint inventory_stock_sane
    check (current_stock >= 0 and minimum_stock >= 0 and purchase_price >= 0);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 3. Atomic stock movements
--
--    The application used to read current_stock, insert a transaction, then
--    write the new stock back — three separate round trips. If any step
--    failed, or two people recorded usage at the same moment, current_stock
--    drifted away from the transaction history.
--
--    SECURITY INVOKER (the default) is deliberate: the caller's RLS policies
--    still apply, so this does not become a privilege-escalation path.
-- ---------------------------------------------------------------------------

create or replace function record_stock_movement(
  p_item_id   uuid,
  p_type      text,
  p_quantity  integer,
  p_reference text default '',
  p_notes     text default ''
) returns integer
language plpgsql
as $$
declare
  v_current integer;
  v_next    integer;
begin
  if p_type not in ('IN', 'OUT') then
    raise exception 'Stock movement type must be IN or OUT.';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Stock movement quantity must be greater than zero.';
  end if;

  -- Lock the item row so a concurrent movement can't read the same balance.
  select current_stock into v_current
  from inventory_items
  where id = p_item_id
  for update;

  if not found then
    raise exception 'That inventory item no longer exists.';
  end if;

  v_next := v_current + (case when p_type = 'IN' then p_quantity else -p_quantity end);

  if v_next < 0 then
    raise exception 'Only % in stock — recording % out would take it below zero.', v_current, p_quantity;
  end if;

  insert into inventory_transactions (item_id, type, quantity, reference, notes)
  values (p_item_id, p_type, p_quantity, coalesce(p_reference, ''), coalesce(p_notes, ''));

  update inventory_items set current_stock = v_next where id = p_item_id;

  return v_next;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Indexes for the lookups the app actually does
-- ---------------------------------------------------------------------------

create index if not exists invoices_order_id_idx         on invoices(order_id);
create index if not exists invoices_customer_id_idx      on invoices(customer_id);
create index if not exists orders_customer_id_idx        on orders(customer_id);
create index if not exists quotations_customer_id_idx    on quotations(customer_id);
create index if not exists designs_order_id_idx          on designs(order_id);
create index if not exists designs_customer_id_idx       on designs(customer_id);
create index if not exists digitizing_jobs_order_id_idx  on digitizing_jobs(order_id);
create index if not exists digitizing_jobs_design_id_idx on digitizing_jobs(design_id);
create index if not exists production_jobs_order_id_idx  on production_jobs(order_id);
create index if not exists qc_records_production_id_idx  on qc_records(production_id);

-- Make PostgREST notice the new column and function immediately.
notify pgrst, 'reload schema';
