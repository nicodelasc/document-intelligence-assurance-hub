import Link from "next/link";

export const metadata = { title: "Page not found — Document Intelligence Assurance Hub" };

export default function NotFound() {
  return <main id="main-content" className="page route-error"><h1>Page not found</h1><p>This page does not exist or is no longer available.</p><Link className="button button--primary" href="/workbench">Return to Workbench</Link></main>;
}
