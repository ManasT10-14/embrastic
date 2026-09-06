# EMBRASTIC — Embroidery Business OS

A business management system for a custom embroidery/stitching business: customers, quotations, orders, artwork & digitizing, production, quality control, inventory, invoicing, payments, expenses and reporting in one connected app.

See [`PROJECT.md`](./PROJECT.md) for the full product/architecture handoff — read that before making significant changes.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS
- Supabase (Postgres + Auth) via `@supabase/ssr` / `@supabase/supabase-js`
- Deployed on Vercel

This is a **single shared-business app**: every authenticated user reads and writes the same data. It is not multi-tenant SaaS.

## Local setup

1. **Create a Supabase project** at [supabase.com](https://supabase.com).
2. **Run the schema migrations, in order.** Open the Supabase SQL Editor and run:
   - `supabase/migrations/001_initial_schema.sql` — tables, foreign keys, RLS policies.
   - `supabase/migrations/002_business_rules.sql` — the agreed discount/GST on orders, the CHECK constraints that keep quantities and percentages sane, and the atomic `record_stock_movement()` function.

   Both are required. `002` is idempotent, so re-running it is safe. If it hasn't been run, the app shows a banner on every page telling you so, rather than failing halfway through saving an order.

   (Or `supabase db push` if you have the CLI linked to your project.)
3. **Copy environment variables:**
   ```
   cp .env.example .env.local
   ```
   Fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from your Supabase project's API settings. Leave `NEXT_PUBLIC_SITE_URL` unset locally (it defaults to `http://localhost:3000`).
4. **Install dependencies and run:**
   ```
   npm install
   npm run dev
   ```
   Open http://localhost:3000.
5. **Create your first user** via the Sign Up page — Supabase Auth handles this; there's no separate admin setup.

## Deploying to production (Vercel + Supabase)

1. Push this repository to GitHub and import it into Vercel.
2. In the Vercel project's Environment Variables, set:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `NEXT_PUBLIC_SITE_URL` — set this to your real production domain (e.g. `https://embrastic.vercel.app`). This matters: it's what auth redirect emails and page metadata resolve to, and it must not be left to fall back to Vercel's per-deployment URL.
3. In your Supabase project, go to **Authentication → URL Configuration** and add your production domain's `/auth/update-password` and `/protected` paths to the allowed redirect URLs (e.g. `https://embrastic.vercel.app/auth/update-password`).
4. Deploy. `npm run build` runs with TypeScript `strict` mode and ESLint on — a clean build is a real signal, not masked by ignore flags.

## Project structure

```
app/
  auth/            Login, sign-up, password reset (Supabase Auth)
  protected/       All business modules — customers, quotations, orders, designs,
                    digitizing, production, quality-control, inventory, invoices,
                    payments, expenses, reports, settings, and the dashboard
lib/
  db.ts            All Supabase reads/writes — the single data-access layer
  calculations.ts  Shared GST/discount/total math used everywhere totals appear
  supabase/        Supabase client factories + the proxy.ts auth guard
supabase/
  migrations/      SQL schema, run manually against your Supabase project
```

## Upgrading an existing deployment

When you pull changes that add a migration, run the new `supabase/migrations/*.sql` file in the Supabase SQL Editor **before or right after** deploying. The app checks on load whether the database has what the code expects (`checkSchemaReady` in `lib/db.ts`) and shows an actionable banner if not.
