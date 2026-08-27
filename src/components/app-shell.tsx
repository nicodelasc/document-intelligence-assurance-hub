"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <div id="app-shell">
        <header className="app-header">
          <Link href="/workbench" className="product-name">Document Intelligence Assurance Hub</Link>
          <nav aria-label="Primary navigation">
            <Link href="/workbench" aria-current={pathname === "/workbench" ? "page" : undefined}>Workbench</Link>
            <Link href="/operations" aria-current={pathname === "/operations" ? "page" : undefined}>Operations</Link>
          </nav>
          <span className="prototype-status">Public prototype · recorded</span>
        </header>
        {children}
      </div>
    </>
  );
}
