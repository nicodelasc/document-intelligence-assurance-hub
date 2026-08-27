import type { Metadata } from "next";
import { WorkbenchView } from "@/components/workbench/workbench-view";

export const metadata: Metadata = { title: "Workbench" };

export default function WorkbenchPage() { return <WorkbenchView />; }
