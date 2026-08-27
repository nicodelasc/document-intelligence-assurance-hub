import type { Metadata } from "next";
import { OperationsDashboard } from "@/components/operations/operations-dashboard";

export const metadata: Metadata = { title: "Operations" };

export default function OperationsPage() { return <OperationsDashboard />; }
