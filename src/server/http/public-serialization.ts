import type {
  ActionProposal,
  FieldResult,
  Provider,
  WorkflowEvent,
} from "@/domain/types";
import type {
  PublicRunRecord,
  RunStepRecord,
  SaveRunResultsInput,
} from "@/server/repositories/run-repository";

function cleanText(value: string, maximumLength: number): string {
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, maximumLength);
}

function serializeField(field: FieldResult): FieldResult {
  return {
    key: cleanText(field.key, 80),
    label: cleanText(field.label, 120),
    extractedValue:
      field.extractedValue === null ? null : cleanText(field.extractedValue, 500),
    normalizedValue:
      field.normalizedValue === null ? null : cleanText(field.normalizedValue, 500),
    evidence: field.evidence === null ? null : cleanText(field.evidence, 600),
    page: field.page,
    evaluatorStatus: field.evaluatorStatus,
    referenceMatch: field.referenceMatch,
  };
}

function serializeStep(step: RunStepRecord): RunStepRecord {
  return {
    kind: step.kind,
    stage: cleanText(step.stage, 120),
    timestamp: step.timestamp,
    durationMs: step.durationMs,
    ...(step.safeCode === undefined ? {} : { safeCode: cleanText(step.safeCode, 80) }),
  };
}

export function serializeActionProposal(action: ActionProposal): ActionProposal {
  return {
    type: action.type,
    title: cleanText(action.title, 160),
    summary: cleanText(action.summary, 600),
    payload: action.payload.slice(0, 12).map((entry) => ({
      label: cleanText(entry.label, 120),
      value: cleanText(entry.value, 500),
    })),
    instructionEvidence:
      action.instructionEvidence === null
        ? null
        : cleanText(action.instructionEvidence, 600),
    page: action.page,
    risk: action.risk,
    status: action.status,
    reason: cleanText(action.reason, 600),
    stagedAt: action.stagedAt,
  };
}

function serializeResult(result: SaveRunResultsInput) {
  const legacyCompatible = result as SaveRunResultsInput & {
    documentInstruction?: string | null;
    action?: ActionProposal;
  };
  return {
    fields: result.fields.map(serializeField),
    outcome: result.outcome,
    ...(legacyCompatible.documentInstruction === undefined
      ? {}
      : {
          documentInstruction:
            legacyCompatible.documentInstruction === null
              ? null
              : cleanText(legacyCompatible.documentInstruction, 600),
        }),
    ...(legacyCompatible.action === undefined
      ? {}
      : { action: serializeActionProposal(legacyCompatible.action) }),
    usage: {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    },
    estimatedCostUsd: result.estimatedCostUsd,
    retryCount: result.retryCount,
    latencyMs: result.latencyMs,
    stepDurations: Object.fromEntries(
      Object.entries(result.stepDurations).map(([key, value]) => [cleanText(key, 80), value]),
    ),
    completedAt: result.completedAt,
  };
}

export type PublicRunAttribution = {
  providerCalled: boolean;
  provider: Provider | null;
  model: string | null;
  configuredProvider: Provider;
  configuredModel: string;
};

function serializeAttribution(run: PublicRunRecord): PublicRunAttribution {
  const providerCalled = run.providerDispatched;
  return {
    providerCalled,
    provider: providerCalled ? run.provider : null,
    model: providerCalled ? run.model : null,
    configuredProvider: run.provider,
    configuredModel: run.model,
  };
}

function serializeWorkflowEvent(event: WorkflowEvent): WorkflowEvent {
  return {
    id: cleanText(event.id, 160),
    runId: cleanText(event.runId, 160),
    action: event.action,
    recipientRole:
      event.recipientRole === null ? null : cleanText(event.recipientRole, 80),
    status: event.status,
    createdAt: event.createdAt,
  };
}

function serializeFixtureIdentity(run: PublicRunRecord) {
  return {
    documentFamily:
      run.documentFamily === null ? null : cleanText(run.documentFamily, 80),
    fixtureId: run.fixtureId === null ? null : cleanText(run.fixtureId, 160),
  };
}

export function serializePublicRunListRow(run: PublicRunRecord) {
  return {
    id: run.id,
    ...serializeAttribution(run),
    executionMode: run.executionMode,
    sourceType: run.sourceType,
    status: run.status,
    outcome: run.outcome,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    expiresAt: run.expiresAt,
    deletedAt: run.deletedAt,
    retryCount: run.retryCount,
    latencyMs: run.latencyMs,
    estimatedCostUsd: run.estimatedCostUsd,
    ...(run.status === "expired" || run.status === "deleted"
      ? {}
      : {
          ...serializeFixtureIdentity(run),
          filename: cleanText(run.file.filename, 120),
        }),
  };
}

export function serializePublicRunDetail(run: PublicRunRecord) {
  if (run.status === "expired" || run.status === "deleted") {
    return {
      id: run.id,
      status: run.status,
      expiresAt: run.expiresAt,
      deletedAt: run.deletedAt,
    };
  }

  return {
    id: run.id,
    ...serializeAttribution(run),
    ...serializeFixtureIdentity(run),
    promptVersion: cleanText(run.promptVersion, 120),
    executionMode: run.executionMode,
    sourceType: run.sourceType,
    file: {
      filename: cleanText(run.file.filename, 120),
      mediaType: run.file.mediaType,
      sizeBytes: run.file.sizeBytes,
      pageCount: run.file.pageCount,
    },
    requestedFields: run.requestedFields.map((field) => ({
      key: cleanText(field.key, 80),
      label: cleanText(field.label, 120),
    })),
    status: run.status,
    outcome: run.outcome,
    usage: {
      inputTokens: run.usage.inputTokens,
      outputTokens: run.usage.outputTokens,
    },
    estimatedCostUsd: run.estimatedCostUsd,
    consent: run.consent,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    expiresAt: run.expiresAt,
    deletedAt: run.deletedAt,
    retryCount: run.retryCount,
    latencyMs: run.latencyMs,
    stepDurations: Object.fromEntries(
      Object.entries(run.stepDurations).map(([key, value]) => [cleanText(key, 80), value]),
    ),
    documentUrl: `/api/runs/${encodeURIComponent(run.id)}/document`,
    ...(run.details === undefined
      ? {}
      : {
          details: {
            steps: run.details.steps.map(serializeStep),
            result: run.details.result === null ? null : serializeResult(run.details.result),
            workflowEvents: run.details.workflowEvents.map(serializeWorkflowEvent),
          },
        }),
  };
}
