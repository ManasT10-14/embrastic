// Shared money/GST math used by quotations, orders, invoices, payments,
// dashboard and reports. Keeping this in one place is what keeps those
// pages' totals consistent with each other.

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

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export type InvoiceStatus = "Unpaid" | "Partial" | "Paid";

export function invoiceStatus(total: number, paid: number): InvoiceStatus {
  if (paid <= 0) return "Unpaid";
  if (paid >= total - 0.01) return "Paid";
  return "Partial";
}

export function formatCurrency(amount: number, currency: string = "INR"): string {
  const symbols: Record<string, string> = { INR: "₹", USD: "$", EUR: "€", GBP: "£" };
  const symbol = symbols[currency] ?? currency + " ";
  return `${symbol}${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatDate(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
