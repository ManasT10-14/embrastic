"use client";

import { ReactNode } from "react";
import { Search, X } from "lucide-react";

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      {action && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-16 text-center">
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      <p className="max-w-sm text-sm text-slate-500">{description}</p>
      {action}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-6 sm:pt-10"
      onClick={onClose}
    >
      <div
        className={`w-full ${wide ? "max-w-3xl" : "max-w-md"} rounded-lg bg-white shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <h2 className="truncate text-lg font-semibold text-slate-900">{title}</h2>
          <button
            onClick={onClose}
            className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/**
 * Every status string the app can actually produce has a colour here.
 * A status missing from this map renders grey, which reads as "no status"
 * and makes the pipeline hard to scan.
 */
const STATUS_COLORS: Record<string, string> = {
  // Quotations
  Draft: "bg-slate-100 text-slate-700",
  Sent: "bg-blue-100 text-blue-700",
  Approved: "bg-green-100 text-green-700",
  Rejected: "bg-red-100 text-red-700",
  Converted: "bg-purple-100 text-purple-700",
  // Orders
  New: "bg-blue-100 text-blue-700",
  Confirmed: "bg-indigo-100 text-indigo-700",
  Digitizing: "bg-violet-100 text-violet-700",
  "In Production": "bg-amber-100 text-amber-700",
  Ready: "bg-teal-100 text-teal-700",
  Delivered: "bg-green-100 text-green-700",
  Cancelled: "bg-red-100 text-red-700",
  // Designs
  "Artwork Received": "bg-slate-100 text-slate-700",
  "Test Stitch": "bg-amber-100 text-amber-700",
  "Customer Approval": "bg-blue-100 text-blue-700",
  "Production Ready": "bg-teal-100 text-teal-700",
  "Revision Required": "bg-orange-100 text-orange-700",
  // Production / digitizing
  Queued: "bg-slate-100 text-slate-700",
  "In Progress": "bg-amber-100 text-amber-700",
  Completed: "bg-green-100 text-green-700",
  "On Hold": "bg-orange-100 text-orange-700",
  // QC
  Pending: "bg-slate-100 text-slate-700",
  Pass: "bg-green-100 text-green-700",
  Rework: "bg-amber-100 text-amber-700",
  Fail: "bg-red-100 text-red-700",
  // Invoices
  Unpaid: "bg-red-100 text-red-700",
  Partial: "bg-amber-100 text-amber-700",
  Paid: "bg-green-100 text-green-700",
  Overdue: "bg-red-100 text-red-700",
};

export function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? "bg-slate-100 text-slate-700";
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`}>{status}</span>;
}

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  if (!message) return null;
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      <span>{message}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="shrink-0 text-red-400 hover:text-red-600" aria-label="Dismiss">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export function SuccessBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  if (!message) return null;
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
      <span>{message}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="shrink-0 text-green-500 hover:text-green-700" aria-label="Dismiss">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative w-full sm:max-w-xs">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${inputClass()} pl-9`}
      />
    </div>
  );
}

export function FilterSelect({
  value,
  onChange,
  options,
  allLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  allLabel: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={`${inputClass()} w-full sm:w-48`}>
      <option value="">{allLabel}</option>
      {options.map((option) => (
        <option key={option} value={option}>{option}</option>
      ))}
    </select>
  );
}

/** Search + filters row, wrapping instead of overflowing on small screens. */
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">{children}</div>;
}

export function inputClass(): string {
  return "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";
}

export function labelClass(): string {
  return "mb-1 block text-xs font-medium text-slate-600";
}

export function PrimaryButton({
  children,
  onClick,
  type = "button",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  onClick,
  type = "button",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/** Small inline action used inside table rows. */
export function RowAction({
  children,
  onClick,
  tone = "neutral",
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  tone?: "neutral" | "danger" | "primary";
  disabled?: boolean;
}) {
  const tones = {
    neutral: "text-slate-600 hover:text-slate-900",
    danger: "text-red-500 hover:text-red-700",
    primary: "text-blue-600 hover:text-blue-800",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium hover:underline disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]}`}
    >
      {children}
    </button>
  );
}
