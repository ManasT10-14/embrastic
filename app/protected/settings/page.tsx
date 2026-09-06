"use client";

import { useEffect, useState } from "react";
import { getAllSettings, upsertSettings } from "@/lib/db";
import { PageHeader, ErrorBanner, SuccessBanner, inputClass, labelClass, PrimaryButton, SecondaryButton } from "@/components/business/ui";

type Field = {
  key: string;
  label: string;
  section: string;
  type?: "text" | "number" | "email" | "select";
  options?: string[];
  hint?: string;
  placeholder?: string;
};

const FIELDS: Field[] = [
  { key: "businessName", label: "Business Name", section: "Business Information", hint: "Printed at the top of every invoice." },
  { key: "tagline", label: "Tagline", section: "Business Information" },
  { key: "ownerName", label: "Owner / Contact Person", section: "Business Information" },
  { key: "phone", label: "Phone", section: "Business Information", hint: "Shown on invoices." },
  { key: "email", label: "Email", type: "email", section: "Business Information", hint: "Shown on invoices." },
  { key: "gstNumber", label: "GST Number", section: "Business Information", hint: "Printed as GSTIN on invoices.", placeholder: "27AAAAA0000A1Z5" },
  { key: "panNumber", label: "PAN", section: "Business Information" },
  { key: "address", label: "Address", section: "Business Information", hint: "Shown on invoices." },
  { key: "city", label: "City", section: "Business Information" },
  { key: "state", label: "State", section: "Business Information" },
  { key: "pincode", label: "PIN Code", section: "Business Information" },

  { key: "currency", label: "Currency", type: "select", options: ["INR", "USD", "EUR", "GBP"], section: "Billing", hint: "Symbol used on invoice documents." },
  { key: "defaultGst", label: "Default GST %", type: "number", section: "Billing", hint: "Prefills new quotations, orders and invoices." },
  { key: "dueDays", label: "Payment due in (days)", type: "number", section: "Billing", hint: "Sets the default due date on a new invoice." },
  { key: "paymentTerms", label: "Payment Terms", section: "Billing", hint: "Printed on invoices, e.g. \"50% advance, balance on delivery\"." },

  { key: "quotationPrefix", label: "Quotation Prefix", section: "Document Numbering", placeholder: "QUO-" },
  { key: "orderPrefix", label: "Order Prefix", section: "Document Numbering", placeholder: "ORD-" },
  { key: "invoicePrefix", label: "Invoice Prefix", section: "Document Numbering", placeholder: "INV-" },
  { key: "expensePrefix", label: "Expense Prefix", section: "Document Numbering", placeholder: "EXP-" },
  { key: "designPrefix", label: "Design Code Prefix", section: "Document Numbering", placeholder: "DSG-" },
  { key: "digitizingPrefix", label: "Digitizing Job Prefix", section: "Document Numbering", placeholder: "DGT-" },
];

const DEFAULTS: Record<string, string> = {
  currency: "INR", defaultGst: "18", dueDays: "15",
  quotationPrefix: "QUO-", orderPrefix: "ORD-", invoicePrefix: "INV-",
  expensePrefix: "EXP-", designPrefix: "DSG-", digitizingPrefix: "DGT-",
};

const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export default function SettingsPage() {
  const [values, setValues] = useState<Record<string, string>>(DEFAULTS);
  const [saved, setSaved] = useState<Record<string, string>>(DEFAULTS);
  const [invoiceNotes, setInvoiceNotes] = useState("");
  const [savedNotes, setSavedNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const settings = await getAllSettings();
        const merged = { ...DEFAULTS, ...settings };
        setValues(merged);
        setSaved(merged);
        setInvoiceNotes(settings.invoiceNotes ?? "");
        setSavedNotes(settings.invoiceNotes ?? "");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load settings.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const dirty =
    invoiceNotes !== savedNotes ||
    FIELDS.some((f) => (values[f.key] ?? "") !== (saved[f.key] ?? ""));

  function validate(): string {
    const gst = Number(values.defaultGst);
    if (!Number.isFinite(gst) || gst < 0 || gst > 100) return "Default GST % must be between 0 and 100.";
    const dueDays = Number(values.dueDays);
    if (!Number.isInteger(dueDays) || dueDays < 0 || dueDays > 365) return "Payment due days must be a whole number between 0 and 365.";
    if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) return "Enter a valid business email address.";
    const gstin = (values.gstNumber ?? "").trim().toUpperCase();
    if (gstin && !GSTIN.test(gstin)) return "That doesn't look like a valid 15-character GSTIN.";

    // A prefix that ends in a digit would run into the sequence number
    // (BILL2-0007 reads as 20007 next time round).
    for (const field of FIELDS.filter((f) => f.section === "Document Numbering")) {
      const value = (values[field.key] ?? "").trim();
      if (value && /\d$/.test(value)) {
        return `${field.label} can't end in a digit — it would merge into the document number.`;
      }
    }
    return "";
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");

    const problem = validate();
    if (problem) return setError(problem);

    setSaving(true);
    try {
      const payload = { ...values, gstNumber: (values.gstNumber ?? "").trim().toUpperCase(), invoiceNotes };
      await upsertSettings(payload);
      setSaved(payload);
      setSavedNotes(invoiceNotes);
      setValues(payload);
      setNotice("Settings saved. New documents will use them straight away.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setValues(saved);
    setInvoiceNotes(savedNotes);
    setError("");
    setNotice("");
  }

  if (loading) return <p className="text-sm text-slate-500">Loading settings…</p>;

  const sections = Array.from(new Set(FIELDS.map((f) => f.section)));

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Settings"
        description="Business-wide configuration used across quotations, orders and invoices. Shared by every signed-in user."
      />

      <form onSubmit={handleSave} className="space-y-8">
        <ErrorBanner message={error} onDismiss={() => setError("")} />
        <SuccessBanner message={notice} onDismiss={() => setNotice("")} />

        {sections.map((section) => (
          <div key={section} className="space-y-4">
            <h2 className="text-sm font-semibold text-slate-700">{section}</h2>
            {section === "Document Numbering" && (
              <p className="-mt-2 text-xs text-slate-500">
                Applied to the next document you create. Existing numbers never change, and the sequence keeps
                counting up so a number is never issued twice.
              </p>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {FIELDS.filter((f) => f.section === section).map((f) => (
                <div key={f.key}>
                  <label className={labelClass()} htmlFor={`setting-${f.key}`}>{f.label}</label>
                  {f.type === "select" ? (
                    <select
                      id={`setting-${f.key}`}
                      className={inputClass()}
                      value={values[f.key] ?? ""}
                      onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                    >
                      {(f.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  ) : (
                    <input
                      id={`setting-${f.key}`}
                      type={f.type ?? "text"}
                      className={inputClass()}
                      placeholder={f.placeholder}
                      value={values[f.key] ?? ""}
                      onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                    />
                  )}
                  {f.hint && <p className="mt-1 text-xs text-slate-400">{f.hint}</p>}
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-700">Invoice Notes</h2>
          <label className={labelClass()} htmlFor="setting-invoice-notes">Default note shown on invoices</label>
          <textarea
            id="setting-invoice-notes"
            className={inputClass()}
            rows={3}
            value={invoiceNotes}
            onChange={(e) => setInvoiceNotes(e.target.value)}
            placeholder="e.g. Goods once sold will not be taken back. Thank you for your business."
          />
          <p className="text-xs text-slate-400">Used on an invoice that doesn&apos;t have its own note.</p>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
          {dirty && <span className="text-xs text-amber-700">You have unsaved changes.</span>}
          <SecondaryButton onClick={handleReset} disabled={!dirty || saving}>Discard</SecondaryButton>
          <PrimaryButton type="submit" disabled={saving || !dirty}>{saving ? "Saving…" : "Save Settings"}</PrimaryButton>
        </div>
      </form>
    </div>
  );
}
