import type { Metadata } from "next";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./globals.css";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: { default: "Document Intelligence Assurance Hub", template: "%s — Document Intelligence Assurance Hub" },
  description: "Public-safe recorded document assurance prototype",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-SG">
      <body><AppShell>{children}</AppShell></body>
    </html>
  );
}
