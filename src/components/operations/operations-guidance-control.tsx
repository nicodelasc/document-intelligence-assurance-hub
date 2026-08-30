"use client";

import { GuidanceControl } from "@/components/guidance/guidance-control";
import { OperationsHowItWorksDialog } from "./how-it-works-dialog";

export function OperationsGuidanceControl() {
  return (
    <GuidanceControl renderDialog={(close) => <OperationsHowItWorksDialog onClose={close} />} />
  );
}
