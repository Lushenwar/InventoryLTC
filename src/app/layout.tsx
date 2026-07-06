import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Floor Supply Inventory",
  description: "Long-term care · supply tracking",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
