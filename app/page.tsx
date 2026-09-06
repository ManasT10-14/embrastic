import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center px-6 text-center">
        <div className="mb-4 text-4xl font-black tracking-wide text-blue-400">
          EMBRASTIC
        </div>

        <div className="mb-8 text-sm font-bold tracking-[0.35em] text-amber-400">
          STITCHED TO STAND OUT
        </div>

        <h1 className="max-w-3xl text-4xl font-black md:text-6xl">
          Embroidery Business Management System
        </h1>

        <p className="mt-5 max-w-2xl text-slate-300">
          Manage customers, quotations, orders, artwork, digitizing,
          production, inventory, invoices and payments from one place.
        </p>

        <Link
          href="/protected"
          className="mt-8 rounded-xl bg-blue-600 px-8 py-4 font-bold shadow-lg hover:bg-blue-500"
        >
          Enter EMBRASTIC
        </Link>
      </div>
    </main>
  );
}