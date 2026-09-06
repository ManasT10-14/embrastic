import { createClient } from "@/lib/supabase/client";
import { computeTotals } from "@/lib/calculations";

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
  const { data, error } = await db().from("customers").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapCustomer);
}

export async function createCustomer(input: Omit<CustomerRow, "id" | "createdAt">): Promise<CustomerRow> {
  const { data, error } = await db().from("customers").insert({
    name: input.name, phone: input.phone, email: input.email, address: input.address,
    gst_number: input.gstNumber, notes: input.notes,
  }).select().single();
  if (error) throw new Error(error.message);
  return mapCustomer(data);
}

export async function updateCustomer(id: string, input: Omit<CustomerRow, "id" | "createdAt">): Promise<CustomerRow> {
  const { data, error } = await db().from("customers").update({
    name: input.name, phone: input.phone, email: input.email, address: input.address,
    gst_number: input.gstNumber, notes: input.notes,
  }).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return mapCustomer(data);
}

export async function deleteCustomer(id: string): Promise<void> {
  const { error } = await db().from("customers").delete().eq("id", id);
  if (error) throw new Error(error.message);
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
    customerName: str((row.customers as Row | null)?.name ?? row.customer_name),
    product: str(row.product), quantity: num(row.quantity), rate: num(row.rate),
    discount: num(row.discount), gstPercent: num(row.gst_percent, 18),
    status: str(row.status, "Draft") as QuotationStatus, validUntil: str(row.valid_until),
    notes: str(row.notes), orderId: str(row.order_id), createdAt: str(row.created_at),
  };
}

export async function getQuotations(): Promise<QuotationRow[]> {
  const { data, error } = await db()
    .from("quotations")
    .select("*, customers(name)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapQuotation);
}

export async function createQuotation(input: {
  quoteNumber: string; customerId: string; product: string; quantity: number;
  rate: number; discount: number; gstPercent: number; validUntil: string; notes: string;
}): Promise<QuotationRow> {
  const { data, error } = await db().from("quotations").insert({
    quote_number: input.quoteNumber, customer_id: input.customerId || null, product: input.product,
    quantity: input.quantity, rate: input.rate, discount: input.discount,
    gst_percent: input.gstPercent, valid_until: input.validUntil || null, notes: input.notes,
    status: "Draft",
  }).select("*, customers(name)").single();
  if (error) throw new Error(error.message);
  return mapQuotation(data);
}

export async function updateQuotationStatus(id: string, status: QuotationStatus): Promise<void> {
  const { error } = await db().from("quotations").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteQuotation(id: string): Promise<void> {
  const { error } = await db().from("quotations").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Converts an Approved quotation into a new order, carrying over customer/pricing. */
export async function createOrderFromQuotation(quotationId: string): Promise<OrderRow> {
  const { data: quote, error: qErr } = await db().from("quotations").select("*, customers(name)").eq("id", quotationId).single();
  if (qErr) throw new Error(qErr.message);
  if (quote.status !== "Approved") throw new Error("Only an Approved quotation can be converted to an order.");

  const orderNumber = await getNextOrderNumber();
  const order = await createOrder({
    orderNumber,
    customerId: str(quote.customer_id),
    customerName: str((quote.customers as Row | null)?.name),
    product: str(quote.product),
    quantity: num(quote.quantity),
    rate: num(quote.rate),
    deliveryDate: "",
    status: "New",
    notes: str(quote.notes),
  });

  const { error: linkOrderErr } = await db().from("orders").update({ quotation_id: quotationId }).eq("id", order.id);
  if (linkOrderErr) throw new Error(linkOrderErr.message);
  const { error: linkQuoteErr } = await db().from("quotations").update({ status: "Converted", order_id: order.id }).eq("id", quotationId);
  if (linkQuoteErr) throw new Error(linkQuoteErr.message);

  return order;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export type OrderRow = {
  id: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  quotationId: string;
  product: string;
  quantity: number;
  rate: number;
  amount: number;
  deliveryDate: string;
  status: string;
  notes: string;
  createdAt: string;
};

function mapOrder(row: Row): OrderRow {
  const quantity = num(row.quantity);
  const rate = num(row.rate);
  return {
    id: str(row.id), orderNumber: str(row.order_number), customerId: str(row.customer_id),
    customerName: str((row.customers as Row | null)?.name ?? row.customer_name),
    quotationId: str(row.quotation_id), product: str(row.product), quantity, rate,
    amount: num(row.amount, quantity * rate), deliveryDate: str(row.delivery_date),
    status: str(row.status, "New"), notes: str(row.notes), createdAt: str(row.created_at),
  };
}

export async function getOrders(): Promise<OrderRow[]> {
  const { data, error } = await db().from("orders").select("*, customers(name)").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapOrder);
}

export async function createOrder(input: {
  orderNumber: string; customerId: string; customerName: string; product: string;
  quantity: number; rate: number; deliveryDate: string; status: string; notes: string;
}): Promise<OrderRow> {
  const { data, error } = await db().from("orders").insert({
    order_number: input.orderNumber, customer_id: input.customerId || null,
    customer_name: input.customerName, product: input.product, quantity: input.quantity,
    rate: input.rate, amount: input.quantity * input.rate, delivery_date: input.deliveryDate || null,
    status: input.status, notes: input.notes,
  }).select("*, customers(name)").single();
  if (error) throw new Error(error.message);
  return mapOrder(data);
}

export async function updateOrderStatus(id: string, status: string): Promise<void> {
  const { error } = await db().from("orders").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteOrder(id: string): Promise<void> {
  const { error } = await db().from("orders").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Designs
// ---------------------------------------------------------------------------

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

export async function getDesigns(): Promise<DesignRow[]> {
  const { data, error } = await db().from("designs").select("*, customers(name), orders(order_number)").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapDesign);
}

export async function createDesign(input: {
  code: string; name: string; customerId: string; orderId: string; placement: string;
  width: number; height: number; stitchCount: number; threadColors: string;
  digitizer: string; fileFormat: string; notes: string;
}): Promise<DesignRow> {
  const { data, error } = await db().from("designs").insert({
    code: input.code, name: input.name, customer_id: input.customerId || null,
    order_id: input.orderId || null, placement: input.placement, width: input.width,
    height: input.height, stitch_count: input.stitchCount, thread_colors: input.threadColors,
    digitizer: input.digitizer, file_format: input.fileFormat, notes: input.notes,
    status: "Artwork Received",
  }).select("*, customers(name), orders(order_number)").single();
  if (error) throw new Error(error.message);
  return mapDesign(data);
}

export async function updateDesignStatus(id: string, status: string): Promise<void> {
  const { error } = await db().from("designs").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteDesign(id: string): Promise<void> {
  const { error } = await db().from("designs").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Digitizing Jobs
// ---------------------------------------------------------------------------

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

function mapDigitizingJob(row: Row): DigitizingJobRow {
  return {
    id: str(row.id), jobNumber: str(row.job_number), designId: str(row.design_id),
    designName: str((row.designs as Row | null)?.name), orderId: str(row.order_id),
    orderNumber: str((row.orders as Row | null)?.order_number), customerId: str(row.customer_id),
    customerName: str((row.customers as Row | null)?.name), status: str(row.status, "Queued"),
    dueDate: str(row.due_date), notes: str(row.notes), createdAt: str(row.created_at),
  };
}

export async function getDigitizingJobs(): Promise<DigitizingJobRow[]> {
  const { data, error } = await db()
    .from("digitizing_jobs")
    .select("*, designs(name), orders(order_number), customers(name)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapDigitizingJob);
}

export async function createDigitizingJob(input: {
  jobNumber: string; designId: string; orderId: string; customerId: string;
  dueDate: string; notes: string;
}): Promise<DigitizingJobRow> {
  const { data, error } = await db().from("digitizing_jobs").insert({
    job_number: input.jobNumber, design_id: input.designId || null, order_id: input.orderId || null,
    customer_id: input.customerId || null, due_date: input.dueDate || null, notes: input.notes,
    status: "Queued",
  }).select("*, designs(name), orders(order_number), customers(name)").single();
  if (error) throw new Error(error.message);
  return mapDigitizingJob(data);
}

export async function updateDigitizingStatus(id: string, status: string): Promise<void> {
  const { error } = await db().from("digitizing_jobs").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteDigitizingJob(id: string): Promise<void> {
  const { error } = await db().from("digitizing_jobs").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Production Jobs
// ---------------------------------------------------------------------------

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

function mapProductionJob(row: Row): ProductionJobRow {
  return {
    id: str(row.id), orderId: str(row.order_id), orderNumber: str((row.orders as Row | null)?.order_number),
    designId: str(row.design_id), designName: str(row.design_name || (row.designs as Row | null)?.name),
    customerName: str(row.customer_name), product: str(row.product),
    quantityOrdered: num(row.quantity_ordered), quantityCompleted: num(row.quantity_completed),
    quantityRejected: num(row.quantity_rejected), quantityRework: num(row.quantity_rework),
    machine: str(row.machine), operator: str(row.operator), status: str(row.status, "Queued"),
    notes: str(row.notes), createdAt: str(row.created_at),
  };
}

export async function getProductionJobs(): Promise<ProductionJobRow[]> {
  const { data, error } = await db()
    .from("production_jobs")
    .select("*, orders(order_number), designs(name)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapProductionJob);
}

export async function createProductionJob(input: {
  orderId: string; designId: string; customerName: string; product: string; designName: string;
  quantityOrdered: number; machine: string; operator: string; notes: string;
}): Promise<ProductionJobRow> {
  const { data, error } = await db().from("production_jobs").insert({
    order_id: input.orderId || null, design_id: input.designId || null,
    customer_name: input.customerName, product: input.product, design_name: input.designName,
    quantity_ordered: input.quantityOrdered, machine: input.machine, operator: input.operator,
    notes: input.notes, status: "Queued",
  }).select("*, orders(order_number), designs(name)").single();
  if (error) throw new Error(error.message);
  return mapProductionJob(data);
}

export async function updateProductionJob(id: string, updates: {
  quantityCompleted?: number; quantityRejected?: number; quantityRework?: number; status?: string;
}): Promise<void> {
  const payload: Row = {};
  if (updates.quantityCompleted !== undefined) payload.quantity_completed = updates.quantityCompleted;
  if (updates.quantityRejected !== undefined) payload.quantity_rejected = updates.quantityRejected;
  if (updates.quantityRework !== undefined) payload.quantity_rework = updates.quantityRework;
  if (updates.status !== undefined) payload.status = updates.status;
  const { error } = await db().from("production_jobs").update(payload).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteProductionJob(id: string): Promise<void> {
  const { error } = await db().from("production_jobs").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Records material consumption for a production job: an OUT stock transaction + stock decrement. */
export async function recordMaterialUsage(input: {
  productionJobId: string; productionJobLabel: string; itemId: string; quantity: number;
}): Promise<void> {
  await recordStockMovement({
    itemId: input.itemId, type: "OUT", quantity: input.quantity,
    reference: `Production ${input.productionJobLabel}`, notes: "",
  });
}

// ---------------------------------------------------------------------------
// Quality Control
// ---------------------------------------------------------------------------

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

export async function getQCRecords(): Promise<QCRecordRow[]> {
  const { data, error } = await db().from("qc_records").select("*, orders(order_number)").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapQCRecord);
}

export async function createQCRecord(input: {
  productionId: string; orderId: string; customerName: string; designName: string;
  quantityProduced: number; quantityAccepted: number; quantityRejected: number; quantityRework: number;
  defectTypes: string[]; inspector: string; qcDate: string; result: string; remarks: string;
}): Promise<QCRecordRow> {
  const { data, error } = await db().from("qc_records").insert({
    production_id: input.productionId || null, order_id: input.orderId || null,
    customer_name: input.customerName, design_name: input.designName,
    quantity_produced: input.quantityProduced, quantity_accepted: input.quantityAccepted,
    quantity_rejected: input.quantityRejected, quantity_rework: input.quantityRework,
    defect_types: input.defectTypes, inspector: input.inspector, qc_date: input.qcDate || null,
    result: input.result, remarks: input.remarks,
  }).select("*, orders(order_number)").single();
  if (error) throw new Error(error.message);
  return mapQCRecord(data);
}

export async function deleteQCRecord(id: string): Promise<void> {
  const { error } = await db().from("qc_records").delete().eq("id", id);
  if (error) throw new Error(error.message);
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
    unit: str(row.unit, "Pcs"), currentStock: num(row.current_stock), minimumStock: num(row.minimum_stock),
    purchasePrice: num(row.purchase_price), supplier: str(row.supplier), notes: str(row.notes),
    createdAt: str(row.created_at),
  };
}

export async function getInventoryItems(): Promise<InventoryItemRow[]> {
  const { data, error } = await db().from("inventory_items").select("*").order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapInventoryItem);
}

export async function createInventoryItem(input: {
  sku: string; name: string; category: string; unit: string; openingStock: number;
  minimumStock: number; purchasePrice: number; supplier: string; notes: string;
}): Promise<InventoryItemRow> {
  const { data, error } = await db().from("inventory_items").insert({
    sku: input.sku, name: input.name, category: input.category, unit: input.unit,
    opening_stock: input.openingStock, current_stock: input.openingStock,
    minimum_stock: input.minimumStock, purchase_price: input.purchasePrice,
    supplier: input.supplier, notes: input.notes,
  }).select().single();
  if (error) throw new Error(error.message);
  return mapInventoryItem(data);
}

export async function deleteInventoryItem(id: string): Promise<void> {
  const { error } = await db().from("inventory_items").delete().eq("id", id);
  if (error) throw new Error(error.message);
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
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: Row) => ({
    id: str(row.id), itemId: str(row.item_id), itemName: str((row.inventory_items as Row | null)?.name),
    type: str(row.type, "IN") as "IN" | "OUT", quantity: num(row.quantity), reference: str(row.reference),
    notes: str(row.notes), createdAt: str(row.created_at),
  }));
}

/** Records a stock movement and keeps inventory_items.current_stock consistent. */
export async function recordStockMovement(input: {
  itemId: string; type: "IN" | "OUT"; quantity: number; reference: string; notes: string;
}): Promise<void> {
  const { data: item, error: itemErr } = await db().from("inventory_items").select("current_stock").eq("id", input.itemId).single();
  if (itemErr) throw new Error(itemErr.message);

  const currentStock = num(item?.current_stock);
  const delta = input.type === "IN" ? input.quantity : -input.quantity;
  const nextStock = currentStock + delta;
  if (nextStock < 0) throw new Error("This would take stock below zero.");

  const { error: txErr } = await db().from("inventory_transactions").insert({
    item_id: input.itemId, type: input.type, quantity: input.quantity,
    reference: input.reference, notes: input.notes,
  });
  if (txErr) throw new Error(txErr.message);

  const { error: updateErr } = await db().from("inventory_items").update({ current_stock: nextStock }).eq("id", input.itemId);
  if (updateErr) throw new Error(updateErr.message);
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
    if (Array.isArray(value)) return value as InvoiceItem[];
    return JSON.parse(str(value, "[]"));
  } catch {
    return [];
  }
}

export async function getInvoicesWithPayments(): Promise<InvoiceRow[]> {
  const [invoicesRes, paymentsRes] = await Promise.all([
    db().from("invoices").select("*").order("created_at", { ascending: false }),
    db().from("payments").select("*").order("created_at", { ascending: false }),
  ]);
  if (invoicesRes.error) throw new Error(invoicesRes.error.message);
  if (paymentsRes.error) throw new Error(paymentsRes.error.message);

  const payments = paymentsRes.data ?? [];
  return (invoicesRes.data ?? []).map((row: Row) => {
    const invoicePayments = payments.filter((p: Row) => p.invoice_id === row.id);
    return {
      id: str(row.id), invoiceNumber: str(row.invoice_number), customerId: str(row.customer_id),
      customer: str(row.customer), orderId: str(row.order_id), orderNumber: str(row.order_number),
      invoiceDate: str(row.invoice_date), dueDate: str(row.due_date), items: parseItems(row.items),
      discount: num(row.discount), gstPercent: num(row.gst_percent, 18), notes: str(row.notes),
      createdAt: str(row.created_at),
      payments: invoicePayments.map((p: Row) => ({
        id: str(p.id), invoiceId: str(p.invoice_id), invoiceNumber: str(p.invoice_number),
        date: str(p.date), amount: num(p.amount), method: str(p.method, "Cash"),
        reference: str(p.reference), notes: str(p.notes), createdAt: str(p.created_at),
      })),
    };
  });
}

export async function createInvoice(input: {
  invoiceNumber: string; customerId: string; customer: string; orderId: string; orderNumber: string;
  invoiceDate: string; dueDate: string; items: InvoiceItem[]; discount: number; gstPercent: number; notes: string;
}): Promise<InvoiceRow> {
  const { data, error } = await db().from("invoices").insert({
    invoice_number: input.invoiceNumber, customer_id: input.customerId || null, customer: input.customer,
    order_id: input.orderId || null, order_number: input.orderNumber, invoice_date: input.invoiceDate,
    due_date: input.dueDate, items: input.items, discount: input.discount, gst_percent: input.gstPercent,
    notes: input.notes,
  }).select().single();
  if (error) throw new Error(error.message);
  return {
    id: str(data.id), invoiceNumber: str(data.invoice_number), customerId: str(data.customer_id),
    customer: str(data.customer), orderId: str(data.order_id), orderNumber: str(data.order_number),
    invoiceDate: str(data.invoice_date), dueDate: str(data.due_date), items: parseItems(data.items),
    discount: num(data.discount), gstPercent: num(data.gst_percent, 18), notes: str(data.notes),
    createdAt: str(data.created_at), payments: [],
  };
}

export async function deleteInvoice(id: string): Promise<void> {
  const { error: payErr } = await db().from("payments").delete().eq("invoice_id", id);
  if (payErr) throw new Error(payErr.message);
  const { error } = await db().from("invoices").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function createPayment(input: {
  invoiceId: string; invoiceNumber: string; date: string; amount: number; method: string;
  reference: string; notes: string;
}): Promise<PaymentRow> {
  const { data, error } = await db().from("payments").insert({
    invoice_id: input.invoiceId, invoice_number: input.invoiceNumber, date: input.date,
    amount: input.amount, method: input.method, reference: input.reference, notes: input.notes,
  }).select().single();
  if (error) throw new Error(error.message);
  return {
    id: str(data.id), invoiceId: str(data.invoice_id), invoiceNumber: str(data.invoice_number),
    date: str(data.date), amount: num(data.amount), method: str(data.method, "Cash"),
    reference: str(data.reference), notes: str(data.notes), createdAt: str(data.created_at),
  };
}

export async function deletePayment(id: string): Promise<void> {
  const { error } = await db().from("payments").delete().eq("id", id);
  if (error) throw new Error(error.message);
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

export async function getExpenses(): Promise<ExpenseRow[]> {
  const { data, error } = await db().from("expenses").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapExpense);
}

export async function createExpense(input: Omit<ExpenseRow, "id" | "createdAt">): Promise<ExpenseRow> {
  const { data, error } = await db().from("expenses").insert({
    expense_number: input.expenseNumber, date: input.date, category: input.category,
    vendor: input.vendor, description: input.description, amount: input.amount,
    gst_percent: input.gstPercent, payment_method: input.paymentMethod, reference: input.reference,
    notes: input.notes,
  }).select().single();
  if (error) throw new Error(error.message);
  return mapExpense(data);
}

export async function deleteExpense(id: string): Promise<void> {
  const { error } = await db().from("expenses").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Settings (shared/global — no per-user scoping)
// ---------------------------------------------------------------------------

export async function getAllSettings(): Promise<Record<string, string>> {
  const { data, error } = await db().from("settings").select("*");
  if (error) throw new Error(error.message);
  const result: Record<string, string> = {};
  for (const row of data ?? []) result[str(row.key)] = str(row.value);
  return result;
}

export async function upsertSettings(settings: Record<string, string>): Promise<void> {
  const rows = Object.entries(settings).map(([key, value]) => ({ key, value, updated_at: new Date().toISOString() }));
  const { error } = await db().from("settings").upsert(rows, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

async function getSetting(key: string): Promise<string> {
  const { data, error } = await db().from("settings").select("value").eq("key", key).maybeSingle();
  if (error) return "";
  return str(data?.value);
}

// ---------------------------------------------------------------------------
// Document numbering (reads configurable prefixes from Settings)
// ---------------------------------------------------------------------------

async function getNextNumber(table: string, column: string, prefix: string): Promise<string> {
  const { data, error } = await db().from(table).select("*").order(column, { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  let nextNum = 1;
  if (Array.isArray(data) && data.length > 0) {
    const lastVal = str((data[0] as Row)[column]);
    const match = lastVal.match(/(\d+)$/);
    if (match) nextNum = Number.parseInt(match[1], 10) + 1;
  }
  return `${prefix}${String(nextNum).padStart(4, "0")}`;
}

async function prefixOrDefault(settingKey: string, fallback: string): Promise<string> {
  const configured = await getSetting(settingKey);
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
  return getNextNumber("expenses", "expense_number", "EXP-");
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
  totalOrders: number;
  ordersNeedingAttention: number;
  pendingProduction: number;
  outstandingAmount: number;
  monthlySales: number;
  recentOrders: OrderRow[];
  pipelineByStatus: Record<string, number>;
};

export async function getDashboardData(): Promise<DashboardData> {
  const [orders, invoices, productionJobs] = await Promise.all([
    getOrders(),
    getInvoicesWithPayments(),
    getProductionJobs(),
  ]);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  let outstandingAmount = 0;
  let monthlySales = 0;
  for (const invoice of invoices) {
    const totals = computeTotals(invoice.items, invoice.discount, invoice.gstPercent);
    const paid = invoice.payments.reduce((sum, p) => sum + p.amount, 0);
    outstandingAmount += Math.max(0, totals.total - paid);
    if (new Date(invoice.invoiceDate) >= monthStart) monthlySales += totals.total;
  }

  const pipelineByStatus: Record<string, number> = {};
  for (const order of orders) pipelineByStatus[order.status] = (pipelineByStatus[order.status] ?? 0) + 1;

  return {
    totalOrders: orders.length,
    ordersNeedingAttention: orders.filter((o) => o.status !== "Delivered" && o.status !== "Cancelled" && o.deliveryDate && new Date(o.deliveryDate) < now).length,
    pendingProduction: productionJobs.filter((p) => p.status !== "Completed").length,
    outstandingAmount,
    monthlySales,
    recentOrders: orders.slice(0, 5),
    pipelineByStatus,
  };
}
