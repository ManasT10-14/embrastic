# EMBRASTIC — Project Handoff

This document exists to get another developer (human or AI) from zero to productive on EMBRASTIC without re-deriving the business context from scratch. Read this before making structural changes.

## 1. What EMBRASTIC is

EMBRASTIC is a business operating system for a custom embroidery/stitching business — not a generic CRM or generic accounting tool. It manages the complete lifecycle of an embroidery job: customer intake, quotation, order, artwork/digitizing, production, quality control, invoicing, payment, alongside inventory and expense tracking and financial reporting.

**Who uses it:** the embroidery business owner and their staff, as one shared team — everyone signed in sees and edits the same business data. It is explicitly **not** multi-tenant SaaS; there is no concept of separate "businesses" or per-user data isolation. See §7.

## 2. The business workflow

```
Customer → Quotation → Order → Design/Digitizing → Production → Quality Control → Invoice → Payment
                                        ↕
                                    Inventory
Invoices + Payments + Expenses → Reports
Settings → business identity, numbering, GST defaults — used everywhere above
```

- A **Customer** is recorded once and reused everywhere downstream.
- A **Quotation** is a priced proposal (Draft → Sent → Approved/Rejected). An Approved quotation can be **converted into an Order** (`createOrderFromQuotation` in `lib/db.ts`), carrying over customer, product, quantity, rate **and the agreed discount and GST %** — so the total the customer approved is the total the order and its invoice show. Status transitions are validated in `lib/db.ts` (`allowedQuotationTransitions`); a Converted quotation is frozen and can't be re-converted or deleted.
- An **Order** is confirmed work. Designs, digitizing jobs and production jobs all optionally link back to an order via `order_id`.
- A **Design** tracks artwork through digitizing/approval; a **Digitizing Job** is the actual conversion into an embroidery-ready file, linked to a design and/or order.
- A **Production Job** tracks quantities ordered/completed/rejected/rework against an order and design. Every piece must be accounted for: `completed + rejected + rework <= ordered`, enforced both in `lib/db.ts` and by a database CHECK. Accounting for all of them auto-completes the job. Recording **material usage** (`recordMaterialUsage`) writes an inventory OUT transaction and decrements stock atomically — this is the one place Production and Inventory intersect, and it's user-triggered (there's no automatic bill-of-materials).
- A **QC Record** inspects a production job's output (accepted/rejected/rework counts, defect types, pass/rework/fail result). `accepted + rejected + rework` must equal `produced`, and `produced` can't exceed what the production job actually finished — the first is a database CHECK, the second a cross-table check in `lib/db.ts`.
- An **Invoice** can be created manually (free-text customer, for ad hoc billing) or **from an Order** (pre-fills customer and a line item from the order). Invoice status (Unpaid/Partial/Paid) is always *derived* from linked payments, never stored — see §6.
- A **Payment** is recorded against a specific invoice, capped at that invoice's outstanding balance (re-checked against live data at write time, not just in the form), and can't be dated before the invoice.
- **Expenses** are recorded independently and, together with invoices/payments, feed **Reports**.
- **Settings** is a shared, global key-value store (business identity, numbering prefixes, default GST, payment terms) that other modules actually read — not just a page that saves into a void. See §8.

## 3. Business entities & schema

Full schema: `supabase/migrations/001_initial_schema.sql`. Summary:

| Table | Purpose | Key relationships |
|---|---|---|
| `customers` | Customer records | referenced by almost everything |
| `quotations` | Pricing proposals | `customer_id`, optional `order_id` once converted |
| `orders` | Confirmed work, incl. agreed `discount`/`gst_percent` | `customer_id`, optional `quotation_id` |
| `designs` | Artwork/design tracking | `customer_id`, `order_id` |
| `digitizing_jobs` | Digitizing work | `design_id`, `order_id`, `customer_id` |
| `production_jobs` | Manufacturing | `order_id`, `design_id` |
| `qc_records` | Quality inspection | `production_id`, `order_id` |
| `inventory_items` | Stock items | — |
| `inventory_transactions` | Stock movements (IN/OUT) | `item_id` |
| `invoices` | Billing | `customer_id` (nullable), `order_id` (nullable), `customer`/`order_number` text kept for manual/ad hoc invoices |
| `payments` | Money received | `invoice_id` (cascade delete) |
| `expenses` | Business costs | — |
| `settings` | Global key-value config | shared, `key` primary key, no per-user scoping |

Every table's `created_at` is stamped automatically. IDs are UUIDs (`gen_random_uuid()`).

`002_business_rules.sql` layers business rules onto that schema and **must be run too**: it adds `orders.discount`/`orders.gst_percent`, CHECK constraints that make impossible quantities and out-of-range GST unstorable, and the `record_stock_movement()` function. If it hasn't been run, every page shows a banner saying exactly that rather than failing obscurely mid-workflow (`checkSchemaReady` in `lib/db.ts`).

## 4. Application architecture

- **Next.js 16 App Router**, all business pages are client components (`"use client"`) under `app/protected/*`, reading/writing Supabase directly from the browser via `lib/db.ts` — there is no custom REST API layer.
- **`lib/db.ts`** is the single data-access layer: generic CRUD helpers plus typed per-entity functions (mapping Postgres `snake_case` columns to `camelCase` TypeScript). All business logic that touches the database goes through here.
- **`lib/calculations.ts`** is the single source of truth for money math (`computeTotals`, `invoiceStatus`, `formatCurrency`, `formatDate`) — every page that shows a total, discount, GST amount, or invoice status calls into this file rather than reimplementing the formula. This exists specifically to prevent the quotation/order/invoice totals from drifting out of sync with each other.
- **`components/business/ui.tsx`** holds shared presentational primitives (`PageHeader`, `EmptyState`, `Modal`, `StatusBadge`, form input styling, buttons) used across all 13 business pages, instead of each page hand-rolling its own markup.

## 5. Authentication model

- Supabase Auth (email/password), via `@supabase/ssr`.
- `proxy.ts` (Next.js 16's replacement for `middleware.ts` — note the renamed convention) calls `lib/supabase/proxy.ts`'s `updateSession()` on every request: refreshes the session, redirects unauthenticated users away from `/protected/*` to `/auth/login`, and redirects authenticated users away from the auth pages (except the password-update page, which a just-authenticated recovery link lands on).
- `app/protected/layout.tsx` additionally checks the session client-side and displays the signed-in user's real email in the header — there is no separate "profile" concept; the Supabase Auth user *is* the identity.
- **Single shared business, not multi-tenant:** RLS policies in `001_initial_schema.sql` grant full access to any `auth.role() = 'authenticated'` user, on every table. `lib/db.ts` never filters by the current user's id. This is deliberate — do not "harden" this into per-user row scoping; that would silently break the app for a second staff login (each would see an empty, disjoint dataset). If real multi-tenancy is ever needed, it requires an explicit `businesses`/membership model, not a `user_id` column on every table.

## 6. Important business rules

- **Totals formula** (in `lib/calculations.ts`, used everywhere): `subtotal = Σ(qty × rate)` → `discount` is an absolute amount, clamped to `[0, subtotal]` → `taxable = subtotal - discount` → `gst = taxable × gstPercent / 100` (GST is charged on the **post-discount** amount) → `total = taxable + gst`.
- **Invoice status is derived, never stored.** `invoiceStatus(total, paid)` returns Unpaid/Partial/Paid from the invoice's total and the sum of its linked payments. There is no `status` column on `invoices` — this avoids the classic bug of a stored status drifting out of sync after a payment is added or deleted.
- **Document numbering** (`getNextQuotationNumber`/`getNextOrderNumber`/`getNextInvoiceNumber`/`getNextExpenseNumber`/`getNextDigitizingNumber`/`getNextDesignCode`) reads the configurable prefix from Settings and appends the next zero-padded sequence number. The sequence comes from `nextDocumentNumber()` in `lib/calculations.ts`, which takes the **highest numeric suffix across all existing rows** — deliberately *not* the text-wise largest value, because sorting text picks the wrong row the moment a prefix changes (`INV-0009` sorts above `BILL-0012`) and would re-issue a number already in use.
- **Dates are calendar dates, not instants.** Every stored date (`invoice_date`, `due_date`, `delivery_date`, `qc_date`, payment/expense dates) is a plain `YYYY-MM-DD`. Never build a `Date` from one directly and never derive "today" from `toISOString()` — both shift by a day depending on timezone (in IST, `toISOString()` returns *yesterday* until 05:30 local). Use `todayISO()`, `parseDateOnly()`, `isWithin()` and `isOverdue()` from `lib/calculations.ts`.
- **An expense's `amount` is the pre-GST value**, matching every other document. The cash actually paid out is `expenseTotal()` (`amount + GST`), and that — not the bare `amount` — is what expense totals, the dashboard and the profit figure use. `expenseGst()` is the input-credit side.
- **Deletes refuse rather than orphan.** A customer with quotations/orders/designs/invoices, an order with designs/production/invoices, a design in use, a production job with QC records, an invoice with payments, and an inventory item with stock movements all refuse deletion with a message naming what's in the way. The FKs are `ON DELETE SET NULL`, so deleting anyway would silently detach records — and quotations have no customer-name fallback column, so the customer would vanish entirely.
- **Reports period metrics are intentionally kept separate.** "Invoiced (period)" and "Collected (period)" are each filtered on their own date field (invoice date vs. payment date) and are not subtracted from each other — "Total Outstanding" is always computed all-time (`Σ(total - paid)` across every invoice), because mixing two different date windows to compute "outstanding" produces a misleading number.
- **Inventory consumption is user-triggered, not automatic.** Recording material usage on a production job (or a manual stock movement on the Inventory page) is the only way stock changes — there's no bill-of-materials that auto-consumes stock when a production job is created or completed.
- **Stock movements are atomic.** `recordStockMovement()` calls the `record_stock_movement()` Postgres function, which locks the item row (`SELECT ... FOR UPDATE`), rejects a movement that would go below zero, then writes the transaction row and the new balance in one database transaction. `current_stock` therefore cannot drift away from `inventory_transactions`. For the same reason stock is *not* editable through the item edit form.

## 7. Deployment architecture

- **Supabase** provides the Postgres database, Auth, and RLS-based access control. It is the only backend — there is no separate application server.
- **Vercel** hosts the Next.js app itself (build + serve, edge middleware via `proxy.ts`).
- Configuration lives entirely in environment variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL`) — see `README.md` for exact setup steps, including the Supabase Auth redirect URL configuration required for password reset to work in production.
- `NEXT_PUBLIC_SITE_URL` deliberately takes precedence over Vercel's `VERCEL_URL` in `lib/utils.ts`'s `getBaseUrl()` — `VERCEL_URL` is a per-deployment URL, not necessarily your stable production domain.

## 8. Configuration (Settings page)

Settings (`app/protected/settings/page.tsx`) is a shared, global configuration store — not per-user. Fields and where they're actually consumed:

- **Business identity** (name, tagline, owner, phone, email, GST number, PAN, address, city, state, PIN) — rendered on the printable invoice document (Invoices → View).
- **Numbering prefixes** (`quotationPrefix`, `orderPrefix`, `invoicePrefix`, `expensePrefix`, `designPrefix`, `digitizingPrefix`) — read by the corresponding `getNextX()` function in `lib/db.ts`. A prefix ending in a digit is rejected, since it would merge into the sequence number.
- **`defaultGst`** — prefills the GST% field on new quotations/orders/invoices.
- **`dueDays`** — sets the default due date on a new invoice (invoice date + N days).
- **`currency`** — used by `formatCurrency()` on the invoice document.
- **`paymentTerms`, `invoiceNotes`** — rendered on the printable invoice document.

## 9. Known assumptions & limitations

- Single shared business only (§5, §7) — do not add per-user data isolation without an explicit multi-tenancy redesign.
- No PDF export — the invoice "View/Print" is an HTML document meant to be printed via the browser's print dialog, not a generated PDF file.
- Inventory/production linkage is manual (§6) — there is no automatic bill-of-materials.
- No file upload for artwork — `designs.file_location` is a text field for a reference path/URL, not an actual upload pipeline.
- Numbering is a "highest existing number + 1" scheme computed client-side. It no longer breaks when a prefix changes, but it is still not safe against two staff submitting at the exact same instant (no DB sequence/lock) — a rare edge case for a small business.
- An invoice can only be edited while it has no payments recorded; after that its amounts are frozen and the payments must be removed first. That is deliberate — an invoice whose total moved underneath recorded payments is unauditable.
- Reports' "cash profit" is cash-basis (collected minus expenses paid in the period), not accrual accounting, and does not attempt per-order material costing.
- There is no role separation: every authenticated user has identical full access (§5).
