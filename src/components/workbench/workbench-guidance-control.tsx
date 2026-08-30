"use client";

import { GuidanceControl } from "@/components/guidance/guidance-control";
import { HowItWorksDialog } from "./how-it-works-dialog";

export function WorkbenchGuidanceControl() {
  return (
    <GuidanceControl renderDialog={(close) => <HowItWorksDialog onClose={close} />} />
  );
}
