"use client";

import { useEffect, useState } from "react";
import { getAllSettings, upsertSettings } from "@/lib/db";
import { PageHeader, ErrorBanner, inputClass, labelClass, PrimaryButton } from "@/components/business/ui";

const FIELDS: Array<{ key: string; label: string; type?: string; section: string }> = [
  { key: "businessName", label: "Business Name", section: "Business Information" },
  { key: "tagline", label: "Tagline", section: "Business Information" },
  { key: "ownerName", label: "Owner / Contact Person", section: "Business Information" },
  { key: "phone", label: "Phone", section: "Business Information" },
  { key: "email", label: "Email", type: "email", section: "Business Information" },
  { key: "gstNumber", label: "GST Number", section: "Business Information" },
  { key: "panNumber", label: "PAN", section: "Business Information" },
  { key: "address", label: "Address", section: "Business Information" },
  { key: "city", label: "City", section: "Business Information" },
  { key: "state", label: "State", section: "Business Information" },
  { key: "pincode", label: "PIN Code", section: "Business Information" },
  { key: "invoicePrefix", label: "Invoice Number Prefix", section: "Billing Configuration" },
  { key: "quotationPrefix", label: "Quotation Number Prefix", section: "Billing Configuration" },
  { key: "orderPrefix", label: "Order Number Prefix", section: "Billing Configuration" },
  { key: "currency", label: "Currency (INR/USD/EUR/GBP)", section: "Billing Configuration" },
  { key: "defaultGst", label: "Default GST %", type: "number", section: "Billing Configuration" },
  { key: "paymentTerms", label: "Payment Terms", section: "Billing Configuration" },
];

const DEFAULTS: Record<string, string> = {
  invoicePrefix: "INV-", quotationPrefix: "QUO-", orderPrefix: "ORD-", currency: "INR", defaultGst: "18",
};

export default function SettingsPage() {
  const [values, setValues] = useState<Record<string, string>>(DEFAULTS);
  const [invoiceNotes, setInvoiceNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const settings = await getAllSettings();
        setValues({ ...DEFAULTS, ...settings });
        setInvoiceNotes(settings.invoiceNotes ?? "");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load settings.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaved(false);
    setSaving(true);
    try {
      await upsertSettings({ ...values, invoiceNotes });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-slate-500">Loading settings…</p>;

  const sections = Array.from(new Set(FIELDS.map((f) => f.section)));

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Settings" description="Business-wide configuration used across quotations, orders and invoices. Shared by every signed-in user." />

      <form onSubmit={handleSave} className="space-y-8">
        <ErrorBanner message={error} />
        {saved && <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">Settings saved.</div>}

        {sections.map((section) => (
          <div key={section} className="space-y-4">
            <h2 className="text-sm font-semibold text-slate-700">{section}</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {FIELDS.filter((f) => f.section === section).map((f) => (
                <div key={f.key}>
                  <label className={labelClass()}>{f.label}</label>
                  <input
                    type={f.type ?? "text"}
                    className={inputClass()}
                    value={values[f.key] ?? ""}
                    onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}

        <div>
          <h2 className="mb-4 text-sm font-semibold text-slate-700">Invoice Notes</h2>
          <label className={labelClass()}>Default note shown on invoices</label>
          <textarea className={inputClass()} rows={3} value={invoiceNotes} onChange={(e) => setInvoiceNotes(e.target.value)} />
        </div>

        <div className="flex justify-end">
          <PrimaryButton type="submit" disabled={saving}>{saving ? "Saving…" : "Save Settings"}</PrimaryButton>
        </div>
      </form>
    </div>
  );
}
