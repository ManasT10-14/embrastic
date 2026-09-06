"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { checkSchemaReady } from "@/lib/db";
import { Menu, X, AlertTriangle } from "lucide-react";

const menu: Array<[string, string, string]> = [
  ["Dashboard", "📊", "/protected"],
  ["Customers", "👥", "/protected/customers"],
  ["Quotations", "📝", "/protected/quotations"],
  ["Orders", "📦", "/protected/orders"],
  ["Artwork & Designs", "🎨", "/protected/designs"],
  ["Digitizing", "🧵", "/protected/digitizing"],
  ["Production", "🪡", "/protected/production"],
  ["Quality Control", "✅", "/protected/quality-control"],
  ["Inventory", "📋", "/protected/inventory"],
  ["Invoices", "🧾", "/protected/invoices"],
  ["Payments", "💳", "/protected/payments"],
  ["Expenses", "💰", "/protected/expenses"],
  ["Reports", "📈", "/protected/reports"],
  ["Settings", "⚙️", "/protected/settings"],
];

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const [email, setEmail] = useState("");
  const [initError, setInitError] = useState("");
  const [schemaMissing, setSchemaMissing] = useState<string[]>([]);

  useEffect(() => {
    try {
      const supabase = createClient();
      supabase.auth.getUser().then(({ data, error }) => {
        if (error || !data.user) {
          router.replace("/auth/login");
          return;
        }
        setEmail(data.user.email ?? "");
        setChecked(true);
        // Warn once, up front, if this deployment's database is behind the
        // code — far clearer than a Postgres error halfway through a workflow.
        checkSchemaReady()
          .then((status) => setSchemaMissing(status.missing))
          .catch(() => setSchemaMissing([]));
      }).catch((err) => {
        setInitError(err instanceof Error ? err.message : "Failed to check your session.");
      });
    } catch (err) {
      setInitError(err instanceof Error ? err.message : "Failed to connect to the backend.");
    }
  }, [router]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/auth/login");
  }

  if (initError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-6 text-center">
        <p className="text-sm font-semibold text-red-600">Couldn&apos;t connect to the backend</p>
        <p className="max-w-md text-sm text-slate-500">{initError}</p>
        <p className="max-w-md text-xs text-slate-400">
          This usually means the app&apos;s Supabase environment variables are missing or incorrect for this deployment.
        </p>
        <button onClick={() => window.location.reload()} className="mt-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          Reload
        </button>
      </div>
    );
  }

  if (!checked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        Loading…
      </div>
    );
  }

  const initial = email ? email[0].toUpperCase() : "E";

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <aside
        className={`fixed left-0 top-0 z-40 h-screen w-64 bg-slate-950 text-white transition-transform duration-200 lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-20 items-center justify-between border-b border-white/10 px-5">
          <div>
            <div className="text-xl font-black tracking-wide text-blue-400">EMBRASTIC</div>
            <div className="text-[10px] tracking-[0.25em] text-amber-400">STITCHED TO STAND OUT</div>
          </div>
          <button onClick={() => setMobileOpen(false)} className="rounded-lg bg-white/10 p-2 hover:bg-white/20 lg:hidden" aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="space-y-1 overflow-y-auto p-3" style={{ maxHeight: "calc(100vh - 5rem)" }}>
          {menu.map(([name, icon, route]) => {
            const active = pathname === route;
            return (
              <Link
                key={name}
                href={route}
                className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm transition ${
                  active ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-blue-600/80 hover:text-white"
                }`}
              >
                <span className="flex w-7 shrink-0 items-center justify-center text-lg">{icon}</span>
                <span className="whitespace-nowrap">{name}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <main className="min-h-screen transition-all duration-200 lg:ml-64">
        <header className="sticky top-0 z-20 flex h-20 items-center justify-between border-b bg-white px-4 shadow-sm sm:px-6">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileOpen(true)} className="rounded-lg p-2 hover:bg-slate-100 lg:hidden" aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-lg font-bold sm:text-xl">EMBRASTIC Business OS</h1>
              <p className="hidden text-xs text-slate-500 sm:block">Custom Embroidery Management System</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="max-w-[180px] truncate text-sm font-semibold">{email || "Signed in"}</div>
              <button onClick={handleLogout} className="text-xs text-slate-500 hover:text-slate-700 hover:underline">
                Sign out
              </button>
            </div>
            <button
              onClick={handleLogout}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 font-bold text-white sm:cursor-default"
              title={email}
              aria-label="Sign out"
            >
              {initial}
            </button>
          </div>
        </header>

        {schemaMissing.length > 0 && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 sm:px-6">
            <div className="flex items-start gap-2 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">Your database needs a one-time update</p>
                <p className="mt-0.5">
                  Missing: {schemaMissing.join(", ")}. Open your Supabase project → <strong>SQL Editor</strong>, paste the
                  contents of <code className="rounded bg-amber-100 px-1">supabase/migrations/002_business_rules.sql</code> and
                  run it. Until then, saving orders and stock movements will fail.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="p-4 sm:p-6">{children}</div>
      </main>
    </div>
  );
}
