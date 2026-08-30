"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleHelp } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/primitives";
import { HowItWorksDialog } from "@/components/workbench/how-it-works-dialog";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isWorkbench = pathname === "/workbench";
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
          {isWorkbench ? <WorkbenchGuidanceControl key={pathname} /> : null}
        </header>
        {children}
      </div>
    </>
  );
}

function WorkbenchGuidanceControl() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        intent="primary"
        className="workbench-guidance-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <CircleHelp size={18} strokeWidth={1.75} aria-hidden="true" />
        How it works
      </Button>
      {open ? <HowItWorksDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}
