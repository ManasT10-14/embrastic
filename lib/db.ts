import { createClient } from "@/lib/supabase/client";
import {
  computeTotals, documentTotals, expenseTotal, isOverdue,
  nextDocumentNumber, parseDateOnly, toISODate,
} from "@/lib/calculations";

/**
 * Shared Supabase data-access layer for EMBRASTIC.
 *
 * EMBRASTIC is a single shared-business application: every authenticated
 * user reads and writes the same rows. Nothing here filters by the current
 * user's id — that's enforced by RLS policies (`auth.role() = 'authenticated'`)
 * in supabase/migrations/001_initial_schema.sql, not by this layer.
 */

function db() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    throw new Error(
      "Supabase environment variables are not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }
  return createClient();
}

type Row = Record<string, unknown>;
const str = (v: unknown, fallback = "") => (v === null || v === undefined ? fallback : String(v));
const num = (v: unknown, fallback = 0) => (v === null || v === undefined ? fallback : Number(v));

/**
 * Turns a Postgres error into something the owner can act on. Constraint
 * names come from supabase/migrations/002_business_rules.sql — without this
 * the UI would surface raw `violates check constraint "..."` text.
 */
const MIGRATION_HINT =
  "Your database is missing the latest EMBRASTIC update. In Supabase, open SQL Editor, paste supabase/migrations/002_business_rules.sql and run it.";

function friendlyError(message: string): string {
  // A column or function added by 002 that isn't there yet.
  if (
    /column .*(discount|gst_percent).* does not exist/i.test(message) ||
    /Could not find the '(discount|gst_percent)' column/i.test(message) ||
    message.includes("Could not find the function")
  ) {
    return MIGRATION_HINT;
  }
  if (message.includes("production_quantities_sane")) {
    return "Completed + rejected + rework can't be more than the quantity ordered for this job.";
  }
  if (message.includes("qc_quantities_sane")) {
    return "Accepted + rejected + rework can't be more than the quantity produced.";
  }
  if (message.includes("inventory_stock_sane")) {
    return "That would take stock below zero.";
  }
  if (message.includes("invoices_amounts_sane")) {
    return "Check the invoice: the due date must be on or after the invoice date, and GST must be between 0 and 100%.";
  }
  if (message.includes("orders_amounts_sane") || message.includes("quotations_gst_sane") || message.includes("expenses_amounts_sane")) {
    return "Check the amounts: quantities and rates can't be negative and GST must be between 0 and 100%.";
  }
  if (message.includes("violates foreign key constraint")) {
    return "A record this depends on no longer exists. Refresh the page and try again.";
  }
  return message;
}

function fail(message: string): never {
  throw new Error(friendlyError(message));
}

/** Counts rows matching a filter — used to stop deletes that would orphan data. */
async function countWhere(table: string, column: string, value: string): Promise<number> {
  const { count, error } = await db().from(table).select("id", { count: "exact", head: true }).eq(column, value);
  if (error) fail(error.message);
  return count ?? 0;
}

function describeBlockers(entries: Array<[number, string]>): string {
  return entries
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${count} ${label}${count === 1 ? "" : "s"}`)
    .join(", ");
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export type CustomerRow = {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  gstNumber: string;
  notes: string;
  createdAt: string;
};

function mapCustomer(row: Row): CustomerRow {
  return {
    id: str(row.id), name: str(row.name), phone: str(row.phone), email: str(row.email),
    address: str(row.address), gstNumber: str(row.gst_number), notes: str(row.notes),
    createdAt: str(row.created_at),
  };
}

export async function getCustomers(): Promise<CustomerRow[]> {
  const { data, error } = await db().from("customers").select("*").order("name", { ascending: true });
  if (error) fail(error.message);
  return (data ?? []).map(mapCustomer);
}

export async function createCustomer(input: Omit<CustomerRow, "id" | "createdAt">): Promise<CustomerRow> {
  const { data, error } = await db().from("customers").insert({
    name: input.name.trim(), phone: input.phone, email: input.email, address: input.address,
    gst_number: input.gstNumber, notes: input.notes,
  }).select().single();
  if (error) fail(error.message);
  return mapCustomer(data);
}

export async function updateCustomer(id: string, input: Omit<CustomerRow, "id" | "createdAt">): Promise<CustomerRow> {
  const { data, error } = await db().from("customers").update({
    name: input.name.trim(), phone: input.phone, email: input.email, address: input.address,
    gst_number: input.gstNumber, notes: input.notes,
  }).eq("id", id).select().single();
  if (error) fail(error.message);
  return mapCustomer(data);
}

/**
 * Refuses to delete a customer that still has business history. The FKs are
 * ON DELETE SET NULL, so deleting anyway would leave quotations and invoices
 * silently detached from any customer — unrecoverable, since quotations have
 * no customer-name fallback column.
 */
export async function deleteCustomer(id: string): Promise<void> {
  const [quotations, orders, designs, invoices] = await Promise.all([
    countWhere("quotations", "customer_id", id),
    countWhere("orders", "customer_id", id),
    countWhere("designs", "customer_id", id),
    countWhere("invoices", "customer_id", id),
  ]);
  const blockers = describeBlockers([
    [quotations, "quotation"], [orders, "order"], [designs, "design"], [invoices, "invoice"],
  ]);
  if (blockers) {
    throw new Error(
      `This customer still has ${blockers}. Delete or reassign those first — removing the customer now would leave them without any customer at all.`,
    );
  }
  const { error } = await db().from("customers").delete().eq("id", id);
  if (error) fail(error.message);
}

// ---------------------------------------------------------------------------
// Quotations
// ---------------------------------------------------------------------------

export type QuotationStatus = "Draft" | "Sent" | "Approved" | "Rejected" | "Converted";

export type QuotationRow = {
  id: string;
  quoteNumber: string;
  customerId: string;
  customerName: string;
  product: string;
  quantity: number;
  rate: number;
  discount: number;
  gstPercent: number;
  status: QuotationStatus;
  validUntil: string;
  notes: string;
  orderId: string;
  createdAt: string;
};

function mapQuotation(row: Row): QuotationRow {
  return {
    id: str(row.id), quoteNumber: str(row.quote_number), customerId: str(row.customer_id),
    customerName: str((row.customers as Row | null)?.name),
    product: str(row.product), quantity: num(row.quantity), rate: num(row.rate),
    discount: num(row.discount), gstPercent: num(row.gst_percent, 18),
    status: str(row.status, "Draft") as QuotationStatus, validUntil: str(row.valid_until),
    notes: str(row.notes), orderId: str(row.order_id), createdAt: str(row.created_at),
  };
}

export type QuotationInput = {
  customerId: string; product: string; quantity: number;
  rate: number; discount: number; gstPercent: number; validUntil: string; notes: string;
};

export async function getQuotations(): Promise<QuotationRow[]> {
  const { data, error } = await db()
    .from("quotations")
    .select("*, customers(name)")
    .order("created_at", { ascending: false });
  if (error) fail(error.message);
  return (data ?? []).map(mapQuotation);
}

export async function createQuotation(input: QuotationInput & { quoteNumber: string }): Promise<QuotationRow> {
  const { data, error } = await db().from("quotations").insert({
    quote_number: input.quoteNumber, customer_id: input.customerId || null, product: input.product,
    quantity: input.quantity, rate: input.rate, discount: input.discount,
    gst_percent: input.gstPercent, valid_until: input.validUntil || null, notes: input.notes,
    status: "Draft",
  }).select("*, customers(name)").single();
  if (error) fail(error.message);
  return mapQuotation(data);
}

/** Editing is deliberately limited to quotations that haven't been sent out yet. */
export async function updateQuotation(id: string, input: QuotationInput): Promise<QuotationRow> {
  const { data, error } = await db().from("quotations").update({
    customer_id: input.customerId || null, product: input.product, quantity: input.quantity,
    rate: input.rate, discount: input.discount, gst_percent: input.gstPercent,
    valid_until: input.validUntil || null, notes: input.notes,
  }).eq("id", id).select("*, customers(name)").single();
  if (error) fail(error.message);
  return mapQuotation(data);
}

const QUOTATION_TRANSITIONS: Record<QuotationStatus, QuotationStatus[]> = {
  Draft: ["Sent"],
  Sent: ["Approved", "Rejected"],
  Approved: ["Rejected"],
  Rejected: ["Sent"],
  Converted: [],
};

export function allowedQuotationTransitions(status: QuotationStatus): QuotationStatus[] {
  return QUOTATION_TRANSITIONS[status] ?? [];
}

export async function updateQuotationStatus(id: string, status: QuotationStatus): Promise<void> {
  const { data: current, error: readErr } = await db().from("quotations").select("status").eq("id", id).single();
  if (readErr) fail(readErr.message);
  const from = str(current?.status, "Draft") as QuotationStatus;
  if (from === "Converted") {
    throw new Error("This quotation has already been converted to an order, so its status can't change.");
  }
  if (!allowedQuotationTransitions(from).includes(status)) {
    throw new Error(`A ${from} quotation can't move straight to ${status}.`);
  }
  const { error } = await db().from("quotations").update({ status }).eq("id", id);
  if (error) fail(error.message);
}

export async function deleteQuotation(id: string): Promise<void> {
  const { data, error: readErr } = await db().from("quotations").select("status, order_id").eq("id", id).single();
  if (readErr) fail(readErr.message);
  if (str(data?.status) === "Converted" || str(data?.order_id)) {
    throw new Error("This quotation has already become an order. Delete the order first if you really need to remove it.");
  }
  const { error } = await db().from("quotations").delete().eq("id", id);
  if (error) fail(error.message);
}

/**
 * Converts an Approved quotation into a new order, carrying over the customer,
 * the product, the quantity/rate *and the agreed discount and GST* — so the
 * total the customer approved is the total the order and its invoice show.
 */
export async function createOrderFromQuotation(quotationId: string): Promise<OrderRow> {
  const { data: quote, error: qErr } = await db().from("quotations").select("*, customers(name)").eq("id", quotationId).single();
  if (qErr) fail(qErr.message);
  if (quote.status === "Converted" || quote.order_id) {
    throw new Error("This quotation has already been converted to an order.");
  }
  if (quote.status !== "Approved") {
    throw new Error("Only an Approved quotation can be converted to an order.");
  }

  const orderNumber = await getNextOrderNumber();
  const order = await createOrder({
    orderNumber,
    customerId: str(quote.customer_id),
    customerName: str((quote.customers as Row | null)?.name),
    product: str(quote.product),
    quantity: num(quote.quantity),
    rate: num(quote.rate),
    discount: num(quote.discount),
    gstPercent: num(quote.gst_percent, 18),
    deliveryDate: "",
    status: "New",
    notes: str(quote.notes),
  });

  const { error: linkOrderErr } = await db().from("orders").update({ quotation_id: quotationId }).eq("id", order.id);
  if (linkOrderErr) fail(linkOrderErr.message);
  const { error: linkQuoteErr } = await db().from("quotations").update({ status: "Converted", order_id: order.id }).eq("id", quotationId);
  if (linkQuoteErr) fail(linkQuoteErr.message);

  return order;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export const ORDER_STATUSES = [
  "New", "Confirmed", "Digitizing", "In Production", "Ready", "Delivered", "Cancelled",
] as const;

export type OrderRow = {
  id: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  quotationId: string;
  quoteNumber: string;
  product: string;
  quantity: number;
  rate: number;
  discount: number;
  gstPercent: number;
  amount: number;
  deliveryDate: string;
  status: string;
  notes: string;
  createdAt: string;
};

function mapOrder(row: Row): OrderRow {
  const quantity = num(row.quantity);
  const rate = num(row.rate);
  const discount = num(row.discount);
  const gstPercent = num(row.gst_percent, 18);
  return {
    id: str(row.id), orderNumber: str(row.order_number), customerId: str(row.customer_id),
    customerName: str((row.customers as Row | null)?.name ?? row.customer_name),
    quotationId: str(row.quotation_id), quoteNumber: str((row.quotations as Row | null)?.quote_number),
    product: str(row.product), quantity, rate, discount, gstPercent,
    // The stored amount is the source of truth, but it is recomputed on every
    // write, so this fallback only matters for rows written before 002.
    amount: num(row.amount, documentTotals(quantity, rate, discount, gstPercent).total),
    deliveryDate: str(row.delivery_date),
    status: str(row.status, "New"), notes: str(row.notes), createdAt: str(row.created_at),
  };
}

export type OrderInput = {
  customerId: string; customerName: string; product: string;
  quantity: number; rate: number; discount: number; gstPercent: number;
  deliveryDate: string; status: string; notes: string;
};

export async function getOrders(): Promise<OrderRow[]> {
  const { data, error } = await db()
    .from("orders")
    .select("*, customers(name), quotations!orders_quotation_id_fkey(quote_number)")
    .order("created_at", { ascending: false });
  if (error) fail(error.message);
  return (data ?? []).map(mapOrder);
}

export async function createOrder(input: OrderInput & { orderNumber: string }): Promise<OrderRow> {
  const totals = documentTotals(input.quantity, input.rate, input.discount, input.gstPercent);
  const { data, error } = await db().from("orders").insert({
    order_number: input.orderNumber, customer_id: input.customerId || null,
    customer_name: input.customerName, product: input.product, quantity: input.quantity,
    rate: input.rate, discount: input.discount, gst_percent: input.gstPercent,
    amount: totals.total, delivery_date: input.deliveryDate || null,
    status: input.status, notes: input.notes,
  }).select("*, customers(name)").single();
  if (error) fail(error.message);
  return mapOrder(data);
}

export async function updateOrder(id: string, input: OrderInput): Promise<OrderRow> {
  const totals = documentTotals(input.quantity, input.rate, input.discount, input.gstPercent);
  const { data, error } = await db().from("orders").update({
    customer_id: input.customerId || null, customer_name: input.customerName,
    product: input.product, quantity: input.quantity, rate: input.rate,
    discount: input.discount, gst_percent: input.gstPercent, amount: totals.total,
    delivery_date: input.deliveryDate || null, status: input.status, notes: input.notes,
  }).eq("id", id).select("*, customers(name)").single();
  if (error) fail(error.message);
  return mapOrder(data);
}

export async function updateOrderStatus(id: string, status: string): Promise<void> {
  const { error } = await db().from("orders").update({ status }).eq("id", id);
  if (error) fail(error.message);
}

export async function deleteOrder(id: string): Promise<void> {
  const [designs, digitizing, production, invoices] = await Promise.all([
    countWhere("designs", "order_id", id),
    countWhere("digitizing_jobs", "order_id", id),
    countWhere("production_jobs", "order_id", id),
    countWhere("invoices", "order_id", id),
  ]);
  const blockers = describeBlockers([
    [designs, "design"], [digitizing, "digitizing job"],
    [production, "production job"], [invoices, "invoice"],
  ]);
  if (blockers) {
    throw new Error(`This order still has ${blockers} linked to it. Remove those first.`);
  }
  // Release the quotation so it can be converted again rather than being
  // stranded in Converted with a dangling order_id.
  const { error: unlinkErr } = await db().from("quotations")
    .update({ status: "Approved", order_id: null }).eq("order_id", id);
  if (unlinkErr) fail(unlinkErr.message);
  const { error } = await db().from("orders").delete().eq("id", id);
  if (error) fail(error.message);
}

// ---------------------------------------------------------------------------
// Designs
// ---------------------------------------------------------------------------

export const DESIGN_STATUSES = [
  "Artwork Received", "Digitizing", "Test Stitch", "Customer Approval",
  "Approved", "Production Ready", "Revision Required",
] as const;

export type DesignRow = {
  id: string;
  code: string;
  name: string;
  customerId: string;
  customerName: string;
  orderId: string;
  orderNumber: string;
  placement: string;
  width: number;
  height: number;
  stitchCount: number;
  threadColors: string;
  digitizer: string;
  fileFormat: string;
  status: string;
  notes: string;
  createdAt: string;
};

function mapDesign(row: Row): DesignRow {
  return {
    id: str(row.id), code: str(row.code), name: str(row.name), customerId: str(row.customer_id),
    customerName: str((row.customers as Row | null)?.name ?? row.customer_name),
    orderId: str(row.order_id), orderNumber: str((row.orders as Row | null)?.order_number),
    placement: str(row.placement), width: num(row.width), height: num(row.height),
    stitchCount: num(row.stitch_count), threadColors: str(row.thread_colors),
    digitizer: str(row.digitizer), fileFormat: str(row.file_format, "DST"),
    status: str(row.status, "Artwork Received"), notes: str(row.notes), createdAt: str(row.created_at),
  };
}

export type DesignInput = {
  code: string; name: string; customerId: string; orderId: string; placement: string;
  width: number; height: number; stitchCount: number; threadColors: string;
  digitizer: string; fileFormat: string; notes: string;
};

const DESIGN_SELECT = "*, customers(name), orders(order_number)";

export async function getDesigns(): Promise<DesignRow[]> {
  const { data, error } = await db().from("designs").select(DESIGN_SELECT).order("created_at", { ascending: false });
  if (error) fail(error.message);
  return (data ?? []).map(mapDesign);
}

function designPayload(input: DesignInput): Row {
  return {
    code: input.code.trim(), name: input.name.trim(), customer_id: input.customerId || null,
    order_id: input.orderId || null, placement: input.placement, width: input.width,
    height: input.height, stitch_count: input.stitchCount, thread_colors: input.threadColors,
    digitizer: input.digitizer, file_format: input.fileFormat, notes: input.notes,
  };
}

export async function createDesign(input: DesignInput): Promise<DesignRow> {
  const { data, error } = await db().from("designs")
    .insert({ ...designPayload(input), status: "Artwork Received" })
    .select(DESIGN_SELECT).single();
  if (error) fail(error.message);
  return mapDesign(data);
}

export async function updateDesign(id: string, input: DesignInput): Promise<DesignRow> {
  const { data, error } = await db().from("designs").update(designPayload(input)).eq("id", id).select(DESIGN_SELECT).single();
  if (error) fail(error.message);
  return mapDesign(data);
}

export async function updateDesignStatus(id: string, status: string): Promise<void> {
  const { error } = await db().from("designs").update({ status }).eq("id", id);
  if (error) fail(error.message);
}

export async function deleteDesign(id: string): Promise<void> {
  const [digitizing, production] = await Promise.all([
    countWhere("digitizing_jobs", "design_id", id),
    countWhere("production_jobs", "design_id", id),
  ]);
  const blockers = describeBlockers([[digitizing, "digitizing job"], [production, "production job"]]);
  if (blockers) {
    throw new Error(`This design is used by ${blockers}. Remove those first.`);
  }
  const { error } = await db().from("designs").delete().eq("id", id);
  if (error) fail(error.message);
}

// ---------------------------------------------------------------------------
// Digitizing Jobs
// ---------------------------------------------------------------------------

export const DIGITIZING_STATUSES = ["Queued", "In Progress", "Ready", "Completed", "Revision Required"] as const;

export type DigitizingJobRow = {
  id: string;
  jobNumber: string;
  designId: string;
  designName: string;
  orderId: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  status: string;
  dueDate: string;
  notes: string;
  createdAt: string;
};

const DIGITIZING_SELECT = "*, designs(name, code), orders(order_number), customers(name)";

function mapDigitizingJob(row: Row): DigitizingJobRow {
  const design = row.designs as Row | null;
  return {
    id: str(row.id), jobNumber: str(row.job_number), designId: str(row.design_id),
    designName: design ? `${str(design.code)} — ${str(design.name)}` : "", orderId: str(row.order_id),
    orderNumber: str((row.orders as Row | null)?.order_number), customerId: str(row.customer_id),
    customerName: str((row.customers as Row | null)?.name), status: str(row.status, "Queued"),
    dueDate: str(row.due_date), notes: str(row.notes), createdAt: str(row.created_at),
  };
}

export type DigitizingInput = {
  designId: string; orderId: string; customerId: string; dueDate: string; notes: string;
};

export async function getDigitizingJobs(): Promise<DigitizingJobRow[]> {
  const { data, error } = await db().from("digitizing_jobs").select(DIGITIZING_SELECT).order("created_at", { ascending: false });
  if (error) fail(error.message);
  return (data ?? []).map(mapDigitizingJob);
}

export async function createDigitizingJob(input: DigitizingInput & { jobNumber: string }): Promise<DigitizingJobRow> {
  const { data, error } = await db().from("digitizing_jobs").insert({
    job_number: input.jobNumber, design_id: input.designId || null, order_id: input.orderId || null,
    customer_id: input.customerId || null, due_date: input.dueDate || null, notes: input.notes,
    status: "Queued",
  }).select(DIGITIZING_SELECT).single();
  if (error) fail(error.message);
  return mapDigitizingJob(data);
}

export async function updateDigitizingJob(id: string, input: DigitizingInput): Promise<DigitizingJobRow> {
  const { data, error } = await db().from("digitizing_jobs").update({
    design_id: input.designId || null, order_id: input.orderId || null,
    customer_id: input.customerId || null, due_date: input.dueDate || null, notes: input.notes,
  }).eq("id", id).select(DIGITIZING_SELECT).single();
  if (error) fail(error.message);
  return mapDigitizingJob(data);
}

export async function updateDigitizingStatus(id: string, status: string): Promise<void> {
  const { error } = await db().from("digitizing_jobs").update({ status }).eq("id", id);
  if (error) fail(error.message);
}

export async function deleteDigitizingJob(id: string): Promise<void> {
  const { error } = await db().from("digitizing_jobs").delete().eq("id", id);
  if (error) fail(error.message);
}

// ---------------------------------------------------------------------------
// Production Jobs
// ---------------------------------------------------------------------------

export const PRODUCTION_STATUSES = ["Queued", "In Progress", "Completed", "On Hold"] as const;

export type ProductionJobRow = {
  id: string;
  orderId: string;
  orderNumber: string;
  designId: string;
  designName: string;
  customerName: string;
  product: string;
  quantityOrdered: number;
  quantityCompleted: number;
  quantityRejected: number;
  quantityRework: number;
  machine: string;
  operator: string;
  status: string;
  notes: string;
  createdAt: string;
};

const PRODUCTION_SELECT = "*, orders(order_number), designs(name)";

function mapProductionJob(row: Row): ProductionJobRow {
  return {
    id: str(row.id), orderId: str(row.order_id), orderNumber: str((row.orders as Row | null)?.order_number),
    designId: str(row.design_id), designName: str((row.designs as Row | null)?.name ?? row.design_name),
    customerName: str(row.customer_name), product: str(row.product),
    quantityOrdered: num(row.quantity_ordered), quantityCompleted: num(row.quantity_completed),
    quantityRejected: num(row.quantity_rejected), quantityRework: num(row.quantity_rework),
    machine: str(row.machine), operator: str(row.operator), status: str(row.status, "Queued"),
    notes: str(row.notes), createdAt: str(row.created_at),
  };
}

export type ProductionInput = {
  orderId: string; designId: string; customerName: string; product: string; designName: string;
  quantityOrdered: number; machine: string; operator: string; notes: string;
};

export async function getProductionJobs(): Promise<ProductionJobRow[]> {
  const { data, error } = await db().from("production_jobs").select(PRODUCTION_SELECT).order("created_at", { ascending: false });
  if (error) fail(error.message);
  return (data ?? []).map(mapProductionJob);
}

export async function createProductionJob(input: ProductionInput): Promise<ProductionJobRow> {
  const { data, error } = await db().from("production_jobs").insert({
    order_id: input.orderId || null, design_id: input.designId || null,
    customer_name: input.customerName, product: input.product, design_name: input.designName,
    quantity_ordered: input.quantityOrdered, machine: input.machine, operator: input.operator,
    notes: input.notes, status: "Queued",
  }).select(PRODUCTION_SELECT).single();
  if (error) fail(error.message);
  return mapProductionJob(data);
}

export async function updateProductionJob(id: string, updates: {
  quantityOrdered?: number; quantityCompleted?: number; quantityRejected?: number;
  quantityRework?: number; status?: string; machine?: string; operator?: string; notes?: string;
}): Promise<ProductionJobRow> {
  const { data: current, error: readErr } = await db().from("production_jobs").select("*").eq("id", id).single();
  if (readErr) fail(readErr.message);

  const ordered = updates.quantityOrdered ?? num(current.quantity_ordered);
  const completed = updates.quantityCompleted ?? num(current.quantity_completed);
  const rejected = updates.quantityRejected ?? num(current.quantity_rejected);
  const rework = updates.quantityRework ?? num(current.quantity_rework);

  if ([ordered, completed, rejected, rework].some((n) => !Number.isFinite(n) || n < 0)) {
    throw new Error("Quantities must be zero or more.");
  }
  if (completed + rejected + rework > ordered) {
    throw new Error(
      `Completed (${completed}) + rejected (${rejected}) + rework (${rework}) is more than the ${ordered} ordered for this job.`,
    );
  }

  const payload: Row = {
    quantity_ordered: ordered, quantity_completed: completed,
    quantity_rejected: rejected, quantity_rework: rework,
  };
  if (updates.status !== undefined) payload.status = updates.status;
  if (updates.machine !== undefined) payload.machine = updates.machine;
  if (updates.operator !== undefined) payload.operator = updates.operator;
  if (updates.notes !== undefined) payload.notes = updates.notes;

  // Finishing every piece completes the job without the owner also having to
  // change the status by hand.
  if (updates.status === undefined && ordered > 0 && completed + rejected + rework >= ordered) {
    payload.status = "Completed";
    payload.actual_completion = toISODate(new Date());
  }

  const { data, error } = await db().from("production_jobs").update(payload).eq("id", id).select(PRODUCTION_SELECT).single();
  if (error) fail(error.message);
  return mapProductionJob(data);
}

export async function deleteProductionJob(id: string): Promise<void> {
  const qc = await countWhere("qc_records", "production_id", id);
  if (qc > 0) {
    throw new Error(`This job has ${qc} quality-control record${qc === 1 ? "" : "s"} against it. Delete those first.`);
  }
  const { error } = await db().from("production_jobs").delete().eq("id", id);
  if (error) fail(error.message);
}

/** Records material consumption for a production job: an OUT stock transaction + stock decrement. */
export async function recordMaterialUsage(input: {
  productionJobLabel: string; itemId: string; quantity: number;
}): Promise<void> {
  await recordStockMovement({
    itemId: input.itemId, type: "OUT", quantity: input.quantity,
    reference: `Production ${input.productionJobLabel}`, notes: "",
  });
}

// ---------------------------------------------------------------------------
// Quality Control
// ---------------------------------------------------------------------------

export const QC_RESULTS = ["Pending", "Pass", "Rework", "Fail"] as const;

export type QCRecordRow = {
  id: string;
  productionId: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  designName: string;
  quantityProduced: number;
  quantityAccepted: number;
  quantityRejected: number;
  quantityRework: number;
  defectTypes: string[];
  inspector: string;
  qcDate: string;
  result: string;
  remarks: string;
  createdAt: string;
};

function mapQCRecord(row: Row): QCRecordRow {
  return {
    id: str(row.id), productionId: str(row.production_id), orderId: str(row.order_id),
    orderNumber: str((row.orders as Row | null)?.order_number), customerName: str(row.customer_name),
    designName: str(row.design_name), quantityProduced: num(row.quantity_produced),
    quantityAccepted: num(row.quantity_accepted), quantityRejected: num(row.quantity_rejected),
    quantityRework: num(row.quantity_rework), defectTypes: Array.isArray(row.defect_types) ? row.defect_types as string[] : [],
    inspector: str(row.inspector), qcDate: str(row.qc_date), result: str(row.result, "Pending"),
    remarks: str(row.remarks), createdAt: str(row.created_at),
  };
}

export type QCInput = {
  productionId: string; orderId: string; customerName: string; designName: string;
  quantityProduced: number; quantityAccepted: number; quantityRejected: number; quantityRework: number;
  defectTypes: string[]; inspector: string; qcDate: string; result: string; remarks: string;
};

export async function getQCRecords(): Promise<QCRecordRow[]> {
  const { data, error } = await db().from("qc_records").select("*, orders(order_number)").order("created_at", { ascending: false });
  if (error) fail(error.message);
  return (data ?? []).map(mapQCRecord);
}

export async function createQCRecord(input: QCInput): Promise<QCRecordRow> {
  const { quantityProduced, quantityAccepted, quantityRejected, quantityRework } = input;
  if ([quantityProduced, quantityAccepted, quantityRejected, quantityRework].some((n) => !Number.isFinite(n) || n < 0)) {
    throw new Error("Quantities must be zero or more.");
  }
  if (quantityProduced <= 0) throw new Error("Quantity produced must be greater than zero.");
  if (quantityAccepted + quantityRejected + quantityRework > quantityProduced) {
    throw new Error(
      `Accepted (${quantityAccepted}) + rejected (${quantityRejected}) + rework (${quantityRework}) is more than the ${quantityProduced} produced.`,
    );
  }

  // Cross-check against the production job: QC can't inspect pieces that were
  // never made. This is the one rule a database CHECK can't express.
  if (input.productionId) {
    const { data: job, error: jobErr } = await db().from("production_jobs")
      .select("quantity_completed, quantity_rework").eq("id", input.productionId).single();
    if (jobErr) fail(jobErr.message);
    const available = num(job?.quantity_completed) + num(job?.quantity_rework);
    if (available === 0) {
      throw new Error("This production job hasn't completed any pieces yet — record completed quantity on the job first.");
    }
    if (quantityProduced > available) {
      throw new Error(`This production job has only ${available} piece(s) completed. You can't inspect ${quantityProduced}.`);
    }
  }

  const { data, error } = await db().from("qc_records").insert({
    production_id: input.productionId || null, order_id: input.orderId || null,
    customer_name: input.customerName, design_name: input.designName,
    quantity_produced: quantityProduced, quantity_accepted: quantityAccepted,
    quantity_rejected: quantityRejected, quantity_rework: quantityRework,
    defect_types: input.defectTypes, inspector: input.inspector, qc_date: input.qcDate || null,
    result: input.result, remarks: input.remarks,
  }).select("*, orders(order_number)").single();
  if (error) fail(error.message);
  return mapQCRecord(data);
}

export async function deleteQCRecord(id: string): Promise<void> {
  const { error } = await db().from("qc_records").delete().eq("id", id);
  if (error) fail(error.message);
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export type InventoryItemRow = {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  openingStock: number;
  currentStock: number;
  minimumStock: number;
  purchasePrice: number;
  supplier: string;
  notes: string;
  createdAt: string;
};

function mapInventoryItem(row: Row): InventoryItemRow {
  return {
    id: str(row.id), sku: str(row.sku), name: str(row.name), category: str(row.category),
    unit: str(row.unit, "Pcs"), openingStock: num(row.opening_stock), currentStock: num(row.current_stock),
    minimumStock: num(row.minimum_stock), purchasePrice: num(row.purchase_price),
    supplier: str(row.supplier), notes: str(row.notes), createdAt: str(row.created_at),
  };
}

export function isLowStock(item: InventoryItemRow): boolean {
  if (item.currentStock <= 0) return true;
  return item.minimumStock > 0 && item.currentStock <= item.minimumStock;
}

export type InventoryInput = {
  sku: string; name: string; category: string; unit: string;
  minimumStock: number; purchasePrice: number; supplier: string; notes: string;
};

export async function getInventoryItems(): Promise<InventoryItemRow[]> {
  const { data, error } = await db().from("inventory_items").select("*").order("name", { ascending: true });
  if (error) fail(error.message);
  return (data ?? []).map(mapInventoryItem);
}

export async function createInventoryItem(input: InventoryInput & { openingStock: number }): Promise<InventoryItemRow> {
  const { data, error } = await db().from("inventory_items").insert({
    sku: input.sku.trim(), name: input.name.trim(), category: input.category, unit: input.unit,
    opening_stock: input.openingStock, current_stock: input.openingStock,
    minimum_stock: input.minimumStock, purchase_price: input.purchasePrice,
    supplier: input.supplier, notes: input.notes,
  }).select().single();
  if (error) fail(error.message);
  return mapInventoryItem(data);
}

/**
 * Deliberately cannot change current_stock — stock only moves through
 * recordStockMovement, so the running balance always has a matching
 * transaction behind it.
 */
export async function updateInventoryItem(id: string, input: InventoryInput): Promise<InventoryItemRow> {
  const { data, error } = await db().from("inventory_items").update({
    sku: input.sku.trim(), name: input.name.trim(), category: input.category, unit: input.unit,
    minimum_stock: input.minimumStock, purchase_price: input.purchasePrice,
    supplier: input.supplier, notes: input.notes,
  }).eq("id", id).select().single();
  if (error) fail(error.message);
  return mapInventoryItem(data);
}

export async function deleteInventoryItem(id: string): Promise<void> {
  const movements = await countWhere("inventory_transactions", "item_id", id);
  if (movements > 0) {
    throw new Error(
      `This item has ${movements} stock movement${movements === 1 ? "" : "s"} recorded against it. Deleting it would erase that history — keep the item instead, or clear its movements first.`,
    );
  }
  const { error } = await db().from("inventory_items").delete().eq("id", id);
  if (error) fail(error.message);
}

export type StockTransactionRow = {
  id: string;
  itemId: string;
  itemName: string;
  type: "IN" | "OUT";
  quantity: number;
  reference: string;
  notes: string;
  createdAt: string;
};

export async function getStockTransactions(): Promise<StockTransactionRow[]> {
  const { data, error } = await db()
    .from("inventory_transactions")
    .select("*, inventory_items(name)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) fail(error.message);
  return (data ?? []).map((row: Row) => ({
    id: str(row.id), itemId: str(row.item_id), itemName: str((row.inventory_items as Row | null)?.name),
    type: str(row.type, "IN") as "IN" | "OUT", quantity: num(row.quantity), reference: str(row.reference),
    notes: str(row.notes), createdAt: str(row.created_at),
  }));
}

/**
 * Records a stock movement. The transaction row and the running balance are
 * written by a single Postgres function (see 002_business_rules.sql) so the
 * two can never disagree, even if two people record usage simultaneously.
 */
export async function recordStockMovement(input: {
  itemId: string; type: "IN" | "OUT"; quantity: number; reference: string; notes: string;
}): Promise<number> {
  const { data, error } = await db().rpc("record_stock_movement", {
    p_item_id: input.itemId,
    p_type: input.type,
    p_quantity: input.quantity,
    p_reference: input.reference,
    p_notes: input.notes,
  });
  if (error) fail(error.message);
  return num(data);
}

// ---------------------------------------------------------------------------
// Schema readiness
// ---------------------------------------------------------------------------

/**
 * Checks that migration 002 has been applied to whichever Supabase project
 * this deployment points at. Without it, orders can't store the agreed
 * discount/GST and stock movements have no atomic path — both of which would
 * otherwise surface as confusing Postgres errors mid-workflow.
 */
export async function checkSchemaReady(): Promise<{ ready: boolean; missing: string[] }> {
  const missing: string[] = [];

  const { error: ordersErr } = await db().from("orders").select("discount").limit(1);
  if (ordersErr) missing.push("orders.discount / orders.gst_percent");

  // Probing with an id that matches nothing is safe: the function raises on the
  // lookup, before it writes anything.
  const { error: rpcErr } = await db().rpc("record_stock_movement", {
    p_item_id: "00000000-0000-0000-0000-000000000000",
    p_type: "IN", p_quantity: 1, p_reference: "", p_notes: "",
  });
  if (rpcErr && rpcErr.message.includes("Could not find the function")) {
    missing.push("record_stock_movement()");
  }

  return { ready: missing.length === 0, missing };
}

// ---------------------------------------------------------------------------
// Invoices & Payments
// ---------------------------------------------------------------------------

export type InvoiceItem = {
  description: string;
  quantity: number;
  rate: number;
};

export type PaymentRow = {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  date: string;
  amount: number;
  method: string;
  reference: string;
  notes: string;
  createdAt: string;
};

export type InvoiceRow = {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customer: string;
  orderId: string;
  orderNumber: string;
  invoiceDate: string;
  dueDate: string;
  items: InvoiceItem[];
  discount: number;
  gstPercent: number;
  notes: string;
  createdAt: string;
  payments: PaymentRow[];
};

function parseItems(value: unknown): InvoiceItem[] {
  try {
    const raw = Array.isArray(value) ? value : JSON.parse(str(value, "[]"));
    if (!Array.isArray(raw)) return [];
    return raw.map((item: Row) => ({
      description: str(item.description),
      quantity: num(item.quantity),
      rate: num(item.rate),
    }));
  } catch {
    return [];
  }
}

function mapPayment(p: Row): PaymentRow {
  return {
    id: str(p.id), invoiceId: str(p.invoice_id), invoiceNumber: str(p.invoice_number),
    date: str(p.date), amount: num(p.amount), method: str(p.method, "Cash"),
    reference: str(p.reference), notes: str(p.notes), createdAt: str(p.created_at),
  };
}

export async function getInvoicesWithPayments(): Promise<InvoiceRow[]> {
  const [invoicesRes, paymentsRes] = await Promise.all([
    db().from("invoices").select("*").order("created_at", { ascending: false }),
    db().from("payments").select("*").order("date", { ascending: false }),
  ]);
  if (invoicesRes.error) fail(invoicesRes.error.message);
  if (paymentsRes.error) fail(paymentsRes.error.message);

  const byInvoice = new Map<string, PaymentRow[]>();
  for (const raw of paymentsRes.data ?? []) {
    const payment = mapPayment(raw);
    const list = byInvoice.get(payment.invoiceId);
    if (list) list.push(payment);
    else byInvoice.set(payment.invoiceId, [payment]);
  }

  return (invoicesRes.data ?? []).map((row: Row) => ({
    id: str(row.id), invoiceNumber: str(row.invoice_number), customerId: str(row.customer_id),
    customer: str(row.customer), orderId: str(row.order_id), orderNumber: str(row.order_number),
    invoiceDate: str(row.invoice_date), dueDate: str(row.due_date), items: parseItems(row.items),
    discount: num(row.discount), gstPercent: num(row.gst_percent, 18), notes: str(row.notes),
    createdAt: str(row.created_at),
    payments: byInvoice.get(str(row.id)) ?? [],
  }));
}

/** Total, paid and balance for an invoice, computed the same way everywhere. */
export function invoiceBalance(invoice: InvoiceRow): { total: number; paid: number; balance: number } {
  const total = computeTotals(invoice.items, invoice.discount, invoice.gstPercent).total;
  const paid = invoice.payments.reduce((sum, p) => sum + p.amount, 0);
  return { total, paid, balance: Math.max(0, total - paid) };
}

export type InvoiceInput = {
  customerId: string; customer: string; orderId: string; orderNumber: string;
  invoiceDate: string; dueDate: string; items: InvoiceItem[]; discount: number;
  gstPercent: number; notes: string;
};

function invoicePayload(input: InvoiceInput): Row {
  return {
    customer_id: input.customerId || null, customer: input.customer,
    order_id: input.orderId || null, order_number: input.orderNumber,
    invoice_date: input.invoiceDate, due_date: input.dueDate, items: input.items,
    discount: input.discount, gst_percent: input.gstPercent, notes: input.notes,
  };
}

export async function createInvoice(input: InvoiceInput & { invoiceNumber: string }): Promise<void> {
  const { error } = await db().from("invoices").insert({
    ...invoicePayload(input), invoice_number: input.invoiceNumber,
  });
  if (error) fail(error.message);
}

/** Only invoices with no payments recorded can be edited — see deleteInvoice. */
export async function updateInvoice(id: string, input: InvoiceInput): Promise<void> {
  const paid = await countWhere("payments", "invoice_id", id);
  if (paid > 0) {
    throw new Error("This invoice already has payments recorded against it, so its amounts can't be edited. Delete the payments first if it was raised incorrectly.");
  }
  const { error } = await db().from("invoices").update(invoicePayload(input)).eq("id", id);
  if (error) fail(error.message);
}

/**
 * Refuses to delete an invoice with payments against it. Silently cascading
 * would destroy the record of money actually received.
 */
export async function deleteInvoice(id: string): Promise<void> {
  const paid = await countWhere("payments", "invoice_id", id);
  if (paid > 0) {
    throw new Error(
      `This invoice has ${paid} payment${paid === 1 ? "" : "s"} recorded against it. Delete those payments first if the invoice really was raised in error.`,
    );
  }
  const { error } = await db().from("invoices").delete().eq("id", id);
  if (error) fail(error.message);
}

export async function createPayment(input: {
  invoiceId: string; invoiceNumber: string; date: string; amount: number; method: string;
  reference: string; notes: string;
}): Promise<PaymentRow> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("Payment amount must be greater than zero.");
  }

  // Re-check the balance against live data rather than trusting the page's
  // snapshot: another user (or another tab) may have paid it in the meantime.
  const [invoiceRes, paymentsRes] = await Promise.all([
    db().from("invoices").select("*").eq("id", input.invoiceId).single(),
    db().from("payments").select("amount").eq("invoice_id", input.invoiceId),
  ]);
  if (invoiceRes.error) fail(invoiceRes.error.message);
  if (paymentsRes.error) fail(paymentsRes.error.message);

  const invoice = invoiceRes.data as Row;
  const total = computeTotals(parseItems(invoice.items), num(invoice.discount), num(invoice.gst_percent, 18)).total;
  const alreadyPaid = (paymentsRes.data ?? []).reduce((sum: number, p: Row) => sum + num(p.amount), 0);
  const balance = total - alreadyPaid;

  if (balance <= 0.01) throw new Error("This invoice is already fully paid.");
  if (input.amount > balance + 0.01) {
    throw new Error(`That's more than the ${balance.toFixed(2)} still outstanding on this invoice.`);
  }

  const invoiceDate = parseDateOnly(str(invoice.invoice_date));
  const paymentDate = parseDateOnly(input.date);
  if (invoiceDate && paymentDate && paymentDate < invoiceDate) {
    throw new Error("A payment can't be dated before the invoice itself.");
  }

  const { data, error } = await db().from("payments").insert({
    invoice_id: input.invoiceId, invoice_number: input.invoiceNumber, date: input.date,
    amount: input.amount, method: input.method, reference: input.reference, notes: input.notes,
  }).select().single();
  if (error) fail(error.message);
  return mapPayment(data);
}

export async function deletePayment(id: string): Promise<void> {
  const { error } = await db().from("payments").delete().eq("id", id);
  if (error) fail(error.message);
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export type ExpenseRow = {
  id: string;
  expenseNumber: string;
  date: string;
  category: string;
  vendor: string;
  description: string;
  amount: number;
  gstPercent: number;
  paymentMethod: string;
  reference: string;
  notes: string;
  createdAt: string;
};

function mapExpense(row: Row): ExpenseRow {
  return {
    id: str(row.id), expenseNumber: str(row.expense_number), date: str(row.date),
    category: str(row.category), vendor: str(row.vendor), description: str(row.description),
    amount: num(row.amount), gstPercent: num(row.gst_percent), paymentMethod: str(row.payment_method, "Cash"),
    reference: str(row.reference), notes: str(row.notes), createdAt: str(row.created_at),
  };
}

export type ExpenseInput = Omit<ExpenseRow, "id" | "createdAt" | "expenseNumber">;

function expensePayload(input: ExpenseInput): Row {
  return {
    date: input.date, category: input.category, vendor: input.vendor,
    description: input.description.trim(), amount: input.amount, gst_percent: input.gstPercent,
    payment_method: input.paymentMethod, reference: input.reference, notes: input.notes,
  };
}

export async function getExpenses(): Promise<ExpenseRow[]> {
  const { data, error } = await db().from("expenses").select("*").order("date", { ascending: false });
  if (error) fail(error.message);
  return (data ?? []).map(mapExpense);
}

export async function createExpense(input: ExpenseInput & { expenseNumber: string }): Promise<ExpenseRow> {
  const { data, error } = await db().from("expenses")
    .insert({ ...expensePayload(input), expense_number: input.expenseNumber })
    .select().single();
  if (error) fail(error.message);
  return mapExpense(data);
}

export async function updateExpense(id: string, input: ExpenseInput): Promise<ExpenseRow> {
  const { data, error } = await db().from("expenses").update(expensePayload(input)).eq("id", id).select().single();
  if (error) fail(error.message);
  return mapExpense(data);
}

export async function deleteExpense(id: string): Promise<void> {
  const { error } = await db().from("expenses").delete().eq("id", id);
  if (error) fail(error.message);
}

// ---------------------------------------------------------------------------
// Settings (shared/global — no per-user scoping)
// ---------------------------------------------------------------------------

export async function getAllSettings(): Promise<Record<string, string>> {
  const { data, error } = await db().from("settings").select("*");
  if (error) fail(error.message);
  const result: Record<string, string> = {};
  for (const row of data ?? []) result[str(row.key)] = str(row.value);
  return result;
}

export async function upsertSettings(settings: Record<string, string>): Promise<void> {
  const rows = Object.entries(settings).map(([key, value]) => ({ key, value, updated_at: new Date().toISOString() }));
  const { error } = await db().from("settings").upsert(rows, { onConflict: "key" });
  if (error) fail(error.message);
}

async function getSetting(key: string): Promise<string> {
  const { data, error } = await db().from("settings").select("value").eq("key", key).maybeSingle();
  if (error) return "";
  return str(data?.value);
}

// ---------------------------------------------------------------------------
// Document numbering (reads configurable prefixes from Settings)
// ---------------------------------------------------------------------------

/** See nextDocumentNumber in lib/calculations for why this scans every row. */
async function getNextNumber(table: string, column: string, prefix: string): Promise<string> {
  const { data, error } = await db().from(table).select(column);
  if (error) fail(error.message);
  const existing = ((data ?? []) as unknown as Row[]).map((row) => str(row[column]));
  return nextDocumentNumber(existing, prefix);
}

async function prefixOrDefault(settingKey: string, fallback: string): Promise<string> {
  const configured = (await getSetting(settingKey)).trim();
  if (!configured) return fallback;
  return configured.endsWith("-") ? configured : `${configured}-`;
}

export async function getNextQuotationNumber(): Promise<string> {
  return getNextNumber("quotations", "quote_number", await prefixOrDefault("quotationPrefix", "QUO-"));
}

export async function getNextOrderNumber(): Promise<string> {
  return getNextNumber("orders", "order_number", await prefixOrDefault("orderPrefix", "ORD-"));
}

export async function getNextInvoiceNumber(): Promise<string> {
  return getNextNumber("invoices", "invoice_number", await prefixOrDefault("invoicePrefix", "INV-"));
}

export async function getNextExpenseNumber(): Promise<string> {
  return getNextNumber("expenses", "expense_number", await prefixOrDefault("expensePrefix", "EXP-"));
}

export async function getNextDigitizingNumber(): Promise<string> {
  return getNextNumber("digitizing_jobs", "job_number", await prefixOrDefault("digitizingPrefix", "DGT-"));
}

export async function getNextDesignCode(): Promise<string> {
  return getNextNumber("designs", "code", await prefixOrDefault("designPrefix", "DSG-"));
}

export async function getDefaultGstPercent(): Promise<number> {
  const value = await getSetting("defaultGst");
  const parsed = Number(value);
  return Number.isFinite(parsed) && value !== "" ? parsed : 18;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export type DashboardData = {
  ordersInProgress: number;
  ordersOverdue: number;
  pendingProduction: number;
  pendingQC: number;
  outstandingAmount: number;
  outstandingInvoiceCount: number;
  overdueInvoiceCount: number;
  overdueInvoiceAmount: number;
  invoicedThisMonth: number;
  collectedThisMonth: number;
  expensesThisMonth: number;
  lowStockItems: InventoryItemRow[];
  upcomingDeliveries: OrderRow[];
  recentOrders: OrderRow[];
  pipelineByStatus: Record<string, number>;
};

const ORDER_CLOSED = new Set(["Delivered", "Cancelled"]);

export async function getDashboardData(): Promise<DashboardData> {
  const [orders, invoices, productionJobs, qcRecords, items, expenses] = await Promise.all([
    getOrders(),
    getInvoicesWithPayments(),
    getProductionJobs(),
    getQCRecords(),
    getInventoryItems(),
    getExpenses(),
  ]);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const inThisMonth = (value: string) => {
    const date = parseDateOnly(value);
    return !!date && date >= monthStart && date < monthEnd;
  };

  let outstandingAmount = 0;
  let outstandingInvoiceCount = 0;
  let overdueInvoiceCount = 0;
  let overdueInvoiceAmount = 0;
  let invoicedThisMonth = 0;
  let collectedThisMonth = 0;

  for (const invoice of invoices) {
    const { total, balance } = invoiceBalance(invoice);
    if (balance > 0.01) {
      outstandingAmount += balance;
      outstandingInvoiceCount += 1;
      if (isOverdue(invoice.dueDate)) {
        overdueInvoiceCount += 1;
        overdueInvoiceAmount += balance;
      }
    }
    if (inThisMonth(invoice.invoiceDate)) invoicedThisMonth += total;
    for (const payment of invoice.payments) {
      if (inThisMonth(payment.date)) collectedThisMonth += payment.amount;
    }
  }

  const pipelineByStatus: Record<string, number> = {};
  for (const order of orders) pipelineByStatus[order.status] = (pipelineByStatus[order.status] ?? 0) + 1;

  const openOrders = orders.filter((o) => !ORDER_CLOSED.has(o.status));

  // A production job that has finished pieces but no QC record yet is work
  // sitting between the machine and the customer — the owner needs to see it.
  const inspected = new Set(qcRecords.map((r) => r.productionId));
  const pendingQC = productionJobs.filter(
    (job) => job.status === "Completed" && !inspected.has(job.id),
  ).length;

  return {
    ordersInProgress: openOrders.length,
    ordersOverdue: openOrders.filter((o) => o.deliveryDate && isOverdue(o.deliveryDate)).length,
    pendingProduction: productionJobs.filter((p) => p.status !== "Completed").length,
    pendingQC,
    outstandingAmount,
    outstandingInvoiceCount,
    overdueInvoiceCount,
    overdueInvoiceAmount,
    invoicedThisMonth,
    collectedThisMonth,
    expensesThisMonth: expenses.filter((e) => inThisMonth(e.date)).reduce((sum, e) => sum + expenseTotal(e), 0),
    lowStockItems: items.filter(isLowStock),
    upcomingDeliveries: openOrders
      .filter((o) => o.deliveryDate)
      .sort((a, b) => (a.deliveryDate < b.deliveryDate ? -1 : 1))
      .slice(0, 5),
    recentOrders: orders.slice(0, 5),
    pipelineByStatus,
  };
}
