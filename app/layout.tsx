import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { getBaseUrl } from "@/lib/utils";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(getBaseUrl()),
  title: "EMBRASTIC — Embroidery Business OS",
  description: "Business management system for custom embroidery businesses: quotations, orders, production, inventory, invoicing and reporting in one place.",
};

const geistSans = Geist({
  variable: "--font-geist-sans",
  display: "swap",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // EMBRASTIC is a light-only interface: the business pages are built on an
  // explicit slate/white palette and there is no theme switcher. Following the
  // OS theme would have rendered the auth cards dark against a light app.
  return (
    <html lang="en">
      <body className={`${geistSans.className} antialiased`}>{children}</body>
    </html>
  );
}
