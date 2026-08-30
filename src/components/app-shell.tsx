"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const WorkbenchGuidanceControl = dynamic(
  () => import("@/components/workbench/workbench-guidance-control")
    .then((module) => module.WorkbenchGuidanceControl),
  {
    ssr: false,
    loading: () => <span className="guidance-placeholder" aria-hidden="true" />,
  },
);

const OperationsGuidanceControl = dynamic(
  () => import("@/components/operations/operations-guidance-control")
    .then((module) => module.OperationsGuidanceControl),
  {
    ssr: false,
    loading: () => <span className="guidance-placeholder" aria-hidden="true" />,
  },
);

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isWorkbench = pathname === "/workbench";
  const isOperations = pathname === "/operations";
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <div id="app-shell">
        <header className="app-header">
          <Link href="/workbench" className="product-name">Document Intelligence Assurance Hub</Link>
          {isWorkbench ? <WorkbenchGuidanceControl key={pathname} /> : null}
          {isOperations ? <OperationsGuidanceControl key={pathname} /> : null}
          <nav aria-label="Primary navigation">
            <Link href="/workbench" aria-current={pathname === "/workbench" ? "page" : undefined}>Workbench</Link>
            <Link href="/operations" aria-current={pathname === "/operations" ? "page" : undefined}>Operations</Link>
          </nav>
        </header>
        {children}
      </div>
    </>
  );
}
