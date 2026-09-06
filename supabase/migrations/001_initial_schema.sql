-- =============================================
-- EMBRASTIC — Full Postgres Schema
-- Single shared-business ERP: every authenticated user
-- sees and shares the SAME data. No per-user tenancy.
-- Run this in the Supabase SQL Editor (or `supabase db push`).
-- =============================================

create extension if not exists "pgcrypto";

-- 1. Customers
create table if not exists customers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  phone       text default '',
  email       text default '',
  address     text default '',
  gst_number  text default '',
  notes       text default '',
  created_at  timestamptz not null default now()
);

-- 2. Quotations
create table if not exists quotations (
  id            uuid primary key default gen_random_uuid(),
  quote_number  text not null,
  customer_id   uuid references customers(id) on delete set null,
  product       text not null default '',
  quantity      integer not null default 0 check (quantity >= 0),
  rate          numeric(12,2) not null default 0 check (rate >= 0),
  discount      numeric(12,2) not null default 0 check (discount >= 0),
  gst_percent   numeric(5,2) not null default 18 check (gst_percent >= 0),
  status        text not null default 'Draft' check (status in ('Draft','Sent','Approved','Rejected','Converted')),
  valid_until   date,
  notes         text not null default '',
  order_id      uuid,
  created_at    timestamptz not null default now()
);

-- 3. Orders
create table if not exists orders (
  id              uuid primary key default gen_random_uuid(),
  order_number    text not null,
  customer_id     uuid references customers(id) on delete set null,
  customer_name   text default '',
  quotation_id    uuid,
  product         text default '',
  quantity        integer default 0,
  rate            numeric(12,2) default 0,
  amount          numeric(12,2) default 0,
  delivery_date   date,
  status          text not null default 'New',
  notes           text default '',
  created_at      timestamptz not null default now()
);

alter table quotations add constraint quotations_order_id_fkey
  foreign key (order_id) references orders(id) on delete set null;
alter table orders add constraint orders_quotation_id_fkey
  foreign key (quotation_id) references quotations(id) on delete set null;

-- 4. Designs
create table if not exists designs (
  id              uuid primary key default gen_random_uuid(),
  code            text not null,
  name            text not null,
  customer_id     uuid references customers(id) on delete set null,
  customer_name   text default '',
  order_id        uuid references orders(id) on delete set null,
  placement       text default 'Left Chest',
  width           numeric(8,2) default 0,
  height          numeric(8,2) default 0,
  stitch_count    integer default 0,
  thread_colors   text default '',
  digitizer       text default '',
  file_format     text default 'DST',
  file_location   text default '',
  version         integer default 1,
  status          text not null default 'Artwork Received',
  notes           text default '',
  created_at      timestamptz not null default now()
);

-- 5. Digitizing Jobs
create table if not exists digitizing_jobs (
  id            uuid primary key default gen_random_uuid(),
  job_number    text not null,
  design_id     uuid references designs(id) on delete set null,
  order_id      uuid references orders(id) on delete set null,
  customer_id   uuid references customers(id) on delete set null,
  status        text not null default 'Queued',
  due_date      date,
  notes         text not null default '',
  created_at    timestamptz not null default now()
);

-- 6. Production Jobs
create table if not exists production_jobs (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid references orders(id) on delete set null,
  design_id             uuid references designs(id) on delete set null,
  customer_name         text default '',
  product               text default '',
  design_name           text default '',
  quantity_ordered      integer default 0,
  quantity_completed     integer default 0,
  quantity_rejected     integer default 0,
  quantity_rework       integer default 0,
  machine               text default '',
  operator              text default '',
  thread_colors         text default '',
  hoop_size             text default '',
  start_date            date,
  expected_completion   date,
  actual_completion     date,
  status                text not null default 'Queued',
  notes                 text default '',
  created_at            timestamptz not null default now()
);

-- 7. Quality Control Records
create table if not exists qc_records (
  id                  uuid primary key default gen_random_uuid(),
  production_id       uuid references production_jobs(id) on delete set null,
  order_id            uuid references orders(id) on delete set null,
  customer_name       text default '',
  design_name         text default '',
  quantity_produced   integer default 0,
  quantity_accepted   integer default 0,
  quantity_rejected   integer default 0,
  quantity_rework     integer default 0,
  defect_types        text[] default '{}',
  inspector           text default '',
  qc_date             date,
  result              text not null default 'Pending',
  remarks             text default '',
  created_at          timestamptz not null default now()
);

-- 8. Inventory Items
create table if not exists inventory_items (
  id              uuid primary key default gen_random_uuid(),
  sku             text not null,
  name            text not null,
  category        text default '',
  unit            text default 'Pcs',
  opening_stock   integer default 0,
  current_stock   integer default 0,
  minimum_stock   integer default 0,
  purchase_price  numeric(12,2) default 0,
  supplier        text default '',
  location        text default '',
  notes           text default '',
  created_at      timestamptz not null default now()
);

-- 9. Inventory Transactions
create table if not exists inventory_transactions (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid references inventory_items(id) on delete cascade,
  type          text not null check (type in ('IN','OUT')),
  quantity      integer not null check (quantity > 0),
  reference     text default '',
  notes         text default '',
  created_at    timestamptz not null default now()
);

-- 10. Invoices
create table if not exists invoices (
  id              uuid primary key default gen_random_uuid(),
  invoice_number  text not null,
  customer_id     uuid references customers(id) on delete set null,
  customer        text not null default '',
  order_id        uuid references orders(id) on delete set null,
  order_number    text default '',
  invoice_date    date not null,
  due_date        date not null,
  items           jsonb not null default '[]',
  discount        numeric(12,2) not null default 0,
  gst_percent     numeric(5,2) not null default 18,
  notes           text default '',
  created_at      timestamptz not null default now()
);

-- 11. Payments
create table if not exists payments (
  id              uuid primary key default gen_random_uuid(),
  invoice_id      uuid references invoices(id) on delete cascade,
  invoice_number  text default '',
  date            date not null,
  amount          numeric(12,2) not null check (amount > 0),
  method          text not null default 'Cash',
  reference       text default '',
  notes           text default '',
  created_at      timestamptz not null default now()
);

-- 12. Expenses
create table if not exists expenses (
  id              uuid primary key default gen_random_uuid(),
  expense_number  text not null,
  date            date not null,
  category        text default '',
  vendor          text default '',
  description     text default '',
  amount          numeric(12,2) not null default 0,
  gst_percent     numeric(5,2) not null default 0,
  payment_method  text not null default 'Cash',
  reference       text default '',
  notes           text default '',
  created_at      timestamptz not null default now()
);

-- 13. Settings (shared, global key-value store — NOT per-user)
create table if not exists settings (
  key         text primary key,
  value       text default '',
  updated_at  timestamptz not null default now()
);

create index if not exists quotations_created_at_idx on quotations(created_at desc);
create index if not exists orders_created_at_idx on orders(created_at desc);
create index if not exists designs_created_at_idx on designs(created_at desc);
create index if not exists digitizing_jobs_created_at_idx on digitizing_jobs(created_at desc);
create index if not exists production_jobs_created_at_idx on production_jobs(created_at desc);
create index if not exists qc_records_created_at_idx on qc_records(created_at desc);
create index if not exists invoices_created_at_idx on invoices(created_at desc);
create index if not exists payments_invoice_id_idx on payments(invoice_id);
create index if not exists expenses_created_at_idx on expenses(created_at desc);
create index if not exists inventory_transactions_item_id_idx on inventory_transactions(item_id);

-- =============================================
-- Row Level Security
-- Single shared business: any authenticated user has full
-- access to all rows. This is intentional — EMBRASTIC is not
-- multi-tenant, so access must NOT be scoped by user_id.
-- =============================================

alter table customers enable row level security;
alter table quotations enable row level security;
alter table orders enable row level security;
alter table designs enable row level security;
alter table digitizing_jobs enable row level security;
alter table production_jobs enable row level security;
alter table qc_records enable row level security;
alter table inventory_items enable row level security;
alter table inventory_transactions enable row level security;
alter table invoices enable row level security;
alter table payments enable row level security;
alter table expenses enable row level security;
alter table settings enable row level security;

create policy "Authenticated full access" on customers            for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "Authenticated full access" on quotations           for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "Authenticated full access" on orders               for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "Authenticated full access" on designs              for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "Authenticated full access" on digitizing_jobs      for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "Authenticated full access" on production_jobs      for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "Authenticated full access" on qc_records           for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "Authenticated full access" on inventory_items      for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "Authenticated full access" on inventory_transactions for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "Authenticated full access" on invoices             for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "Authenticated full access" on payments             for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "Authenticated full access" on expenses             for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "Authenticated full access" on settings             for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
