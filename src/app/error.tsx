"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/primitives";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { document.title = "Safe error — Document Intelligence Assurance Hub"; }, []);
  return <main id="main-content" className="page route-error" role="alert"><h1>This view could not be loaded</h1><p>No private error details were displayed. Retry the current route or return through the navigation.</p><Button type="button" onClick={reset}>Retry view</Button></main>;
}
