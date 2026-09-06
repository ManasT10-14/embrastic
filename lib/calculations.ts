// Shared money/GST and date math used by quotations, orders, invoices, payments,
// dashboard and reports. Keeping this in one place is what keeps those
// pages' totals and period filters consistent with each other.

export type LineItem = {
  description: string;
  quantity: number;
  rate: number;
};

export type Totals = {
  subtotal: number;
  discount: number;
  taxable: number;
  gstAmount: number;
  total: number;
};

/**
 * subtotal = sum(qty * rate)
 * taxable  = subtotal - discount (discount is an absolute amount, clamped to subtotal)
 * gst      = taxable * gstPercent / 100  (GST is charged on the post-discount amount)
 * total    = taxable + gst
 */
export function computeTotals(
  items: LineItem[],
  discount: number,
  gstPercent: number,
): Totals {
  const subtotal = round2(items.reduce((sum, item) => sum + item.quantity * item.rate, 0));
  const clampedDiscount = round2(Math.min(Math.max(discount, 0), subtotal));
  const taxable = round2(subtotal - clampedDiscount);
  const gstAmount = round2((taxable * gstPercent) / 100);
  const total = round2(taxable + gstAmount);
  return { subtotal, discount: clampedDiscount, taxable, gstAmount, total };
}

/**
 * The value of a single-line document (quotation or order) using exactly the
 * same formula as a multi-line invoice, so an approved quotation, the order it
 * became, and the invoice raised for it all agree on the number.
 */
export function documentTotals(
  quantity: number,
  rate: number,
  discount: number,
  gstPercent: number,
): Totals {
  return computeTotals([{ description: "", quantity, rate }], discount, gstPercent);
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Next document number = highest numeric suffix already issued, plus one.
 *
 * It deliberately scans the numeric tail of *every* existing number instead of
 * taking the text-wise largest: sorting text picks the wrong row the moment
 * the configured prefix changes ("INV-0009" sorts above "BILL-0012"), which
 * would re-issue a number that is already in use.
 */
export function nextDocumentNumber(existingNumbers: string[], prefix: string): string {
  let highest = 0;
  for (const value of existingNumbers) {
    const match = /(\d+)\s*$/.exec(value ?? "");
    if (match) highest = Math.max(highest, Number.parseInt(match[1], 10));
  }
  return `${prefix}${String(highest + 1).padStart(4, "0")}`;
}

export type InvoiceStatus = "Unpaid" | "Partial" | "Paid";

export function invoiceStatus(total: number, paid: number): InvoiceStatus {
  if (paid <= 0) return "Unpaid";
  if (paid >= total - 0.01) return "Paid";
  return "Partial";
}

/**
 * An expense's `amount` is the pre-GST (taxable) value, matching how every
 * other document in the app stores money. This is the cash actually paid out,
 * and it is what expense totals and profit must use — not the bare `amount`.
 */
export function expenseTotal(expense: { amount: number; gstPercent: number }): number {
  return round2(expense.amount + (expense.amount * expense.gstPercent) / 100);
}

export function expenseGst(expense: { amount: number; gstPercent: number }): number {
  return round2((expense.amount * expense.gstPercent) / 100);
}

export function formatCurrency(amount: number, currency: string = "INR"): string {
  const symbols: Record<string, string> = { INR: "₹", USD: "$", EUR: "€", GBP: "£" };
  const symbol = symbols[currency] ?? currency + " ";
  return `${symbol}${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ---------------------------------------------------------------------------
// Dates
//
// Every date the app stores (invoice_date, due_date, delivery_date, qc_date,
// payment date, expense date) is a plain calendar date — "2026-09-01" — with
// no time and no timezone. `new Date("2026-09-01")` parses that as UTC
// midnight, which is the *previous* day in any timezone behind UTC and shifts
// month-boundary comparisons everywhere. `new Date().toISOString()` has the
// mirror-image problem: in IST it returns yesterday's date until 05:30 local.
//
// So: never construct a Date from a date string directly, and never derive
// "today" from toISOString. Use these helpers instead.
// ---------------------------------------------------------------------------

/** Today as "YYYY-MM-DD" in the *user's* timezone. */
export function todayISO(): string {
  return toISODate(new Date());
}

/** A Date (assumed local) as "YYYY-MM-DD" in the user's timezone. */
export function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Parses a stored "YYYY-MM-DD" as local midnight, so it compares correctly
 * against locally-constructed month boundaries. Returns null when unparseable.
 * Also tolerates full timestamps (created_at), which are genuine instants.
 */
export function parseDateOnly(value: string): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDate(value: string): string {
  const date = parseDateOnly(value);
  if (!date) return value || "—";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/** True when `value` falls inside [start, end). A null range means "all time". */
export function isWithin(value: string, range: { start: Date; end: Date } | null): boolean {
  if (!range) return true;
  const date = parseDateOnly(value);
  if (!date) return false;
  return date >= range.start && date < range.end;
}

/** True when a due/delivery date is strictly before today. */
export function isOverdue(value: string): boolean {
  const date = parseDateOnly(value);
  if (!date) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date < today;
}

/** Whole days from today until `value`. Negative when already past. */
export function daysUntil(value: string): number | null {
  const date = parseDateOnly(value);
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((date.getTime() - today.getTime()) / 86_400_000);
}
