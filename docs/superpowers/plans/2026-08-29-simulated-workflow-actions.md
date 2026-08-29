# Simulated Workflow Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single staging button with outcome-specific simulated workflow actions, prepared email previews and a durable public-safe activity timeline.

**Architecture:** A pure domain policy owns allowed actions and recipient roles. One capability-protected route creates idempotent `workflow_events` without sending email or contacting another system. The Workbench renders controls from the verified outcome while run detail and Operations read the same persisted timeline.

**Tech Stack:** Next.js 16.3.3, React 19.2.8, TypeScript 6.0.3, Zod 4.4.3, Neon Postgres, Vitest 4.1.11 and Playwright 1.62.1.

**Spec:** `docs/superpowers/specs/2026-08-29-document-operations-workflow-redesign.md`

**Prerequisite:** Complete `docs/superpowers/plans/2026-08-29-document-library-ai-processing.md` through Task 3 so migration 0008 and run identity fields exist.

## Global Constraints

- Every workflow event is simulated and must say so in the interface.
- No route sends email, opens a mail client or contacts an ERP, payment, inventory, supplier, ticketing or RPA system.
- Never request, accept or store a real recipient address.
- Recipient roles come from a server-owned allowlist keyed by document family.
- Every mutation requires the browser-held run capability and existing public-read rate limits.
- Expired and deleted runs expose no workflow mutation. Failed runs allow only recovery or diagnostic-summary actions and never approval.
- `retry_processing` records intent on the old run then creates a new run through the normal processing path.
- Email subject and body are generated on demand and never persisted.
- Follow TDD and commit each independently testable unit.

---

### Task 1: Define workflow policy, schemas and email previews

**Files:**

- Modify: `src/domain/types.ts`
- Create: `src/domain/workflow-actions.ts`
- Modify: `src/domain/run-schema.ts`
- Create: `tests/unit/domain/workflow-actions.test.ts`
- Modify: `tests/unit/domain/run-schema.test.ts`

**Interfaces:**

- Produces: `WorkflowActionType`, `WorkflowEventStatus`, `WorkflowEvent`, `WorkflowActionRequest` and `EmailPreview`.
- Produces: `allowedWorkflowActionsForRun`, `allowedRecipientRoles`, `workflowActionRequiresRecipient`, `recipientRoleAllowed`, `workflowStatusForAction` and `createEmailPreview`.
- Consumes: `Outcome`, `RunStatus`, `DocumentFamily`, `FieldResult` and active public-safe run data.

- [ ] **Step 1: Write failing policy tests**

Use exact status-aware allowlists:

```ts
expect(
  allowedWorkflowActionsForRun({ status: "completed", outcome: "clear" }),
).toEqual([
  "approve_and_stage",
  "prepare_email",
  "download_summary",
  "mark_for_later_review",
]);
expect(
  allowedWorkflowActionsForRun({
    status: "completed",
    outcome: "evidence_consistent",
  }),
).toEqual([
  "approve_and_stage",
  "prepare_email",
  "download_summary",
  "mark_for_later_review",
]);
expect(
  allowedWorkflowActionsForRun({
    status: "completed",
    outcome: "needs_review",
  }),
).toEqual([
  "assign_review",
  "request_clarification",
  "prepare_email",
  "replace_document",
  "download_summary",
]);
expect(
  allowedWorkflowActionsForRun({ status: "completed", outcome: "conflict" }),
).toEqual([
  "assign_review",
  "request_clarification",
  "prepare_email",
  "replace_document",
  "download_summary",
]);
expect(
  allowedWorkflowActionsForRun({ status: "completed", outcome: "incomplete" }),
).toEqual([
  "request_clearer_document",
  "prepare_email",
  "assign_review",
  "replace_document",
  "retry_processing",
]);
expect(
  allowedWorkflowActionsForRun({ status: "completed", outcome: "not_found" }),
).toEqual([
  "request_clearer_document",
  "prepare_email",
  "assign_review",
  "replace_document",
  "retry_processing",
]);
expect(
  allowedWorkflowActionsForRun({ status: "failed", outcome: null }),
).toEqual(["retry_processing", "download_summary"]);
expect(
  allowedWorkflowActionsForRun({ status: "expired", outcome: null }),
).toEqual([]);
expect(
  allowedWorkflowActionsForRun({ status: "deleted", outcome: null }),
).toEqual([]);
```

Assert role catalogues:

```ts
expect(allowedRecipientRoles("supplier_invoice")).toEqual([
  "Accounts Payable Analyst",
  "Buyer",
  "Supplier Contact",
]);
expect(allowedRecipientRoles("warehouse_goods_receipt")).toEqual([
  "Warehouse Lead",
  "Buyer",
  "Supplier Contact",
]);
expect(allowedRecipientRoles(null)).toEqual(["Document Owner", "Reviewer"]);
expect(recipientRoleAllowed("prepare_email", "supplier_invoice", null)).toBe(
  false,
);
expect(recipientRoleAllowed("prepare_email", "supplier_invoice", "Buyer")).toBe(
  true,
);
expect(
  recipientRoleAllowed("retry_processing", "supplier_invoice", "Buyer"),
).toBe(false);
expect(recipientRoleAllowed("retry_processing", "supplier_invoice", null)).toBe(
  true,
);
expect(workflowActionRequiresRecipient("assign_review")).toBe(true);
expect(workflowActionRequiresRecipient("download_summary")).toBe(false);
```

Assert the email preview contains `Prepared only - not sent`, contains the run ID and outcome and never contains `@`. Pass field labels and extracted values containing `alex@example.com`, `alex@intranet` and a lone `@` then assert the address-like token is rendered as `[address redacted]` and every remaining at-sign is rendered as `[at redacted]`.

- [ ] **Step 2: Run policy tests and confirm failure**

```powershell
npx vitest run tests/unit/domain/workflow-actions.test.ts tests/unit/domain/run-schema.test.ts
```

Expected: FAIL because the workflow domain module and schemas do not exist.

- [ ] **Step 3: Add exact workflow contracts**

Add to `src/domain/types.ts`:

```ts
export type WorkflowActionType =
  | "approve_and_stage"
  | "mark_for_later_review"
  | "assign_review"
  | "request_clarification"
  | "request_clearer_document"
  | "prepare_email"
  | "replace_document"
  | "retry_processing"
  | "download_summary";

export type WorkflowEventStatus = "prepared" | "staged" | "simulated";

export interface WorkflowEvent {
  id: string;
  runId: string;
  action: WorkflowActionType;
  recipientRole: string | null;
  status: WorkflowEventStatus;
  createdAt: string;
}

export interface EmailPreview {
  recipientRole: string;
  subject: string;
  body: string;
  deliveryStatus: "prepared_only_not_sent";
}
```

- [ ] **Step 4: Implement the pure policy**

Use frozen records in `src/domain/workflow-actions.ts`:

```ts
const actionsByOutcomeGroup = {
  clear: [
    "approve_and_stage",
    "prepare_email",
    "download_summary",
    "mark_for_later_review",
  ],
  needs_review: [
    "assign_review",
    "request_clarification",
    "prepare_email",
    "replace_document",
    "download_summary",
  ],
  incomplete: [
    "request_clearer_document",
    "prepare_email",
    "assign_review",
    "replace_document",
    "retry_processing",
  ],
} as const satisfies Readonly<
  Record<"clear" | "needs_review" | "incomplete", readonly WorkflowActionType[]>
>;

const outcomeGroup: Readonly<
  Record<Outcome, keyof typeof actionsByOutcomeGroup>
> = {
  clear: "clear",
  evidence_consistent: "clear",
  needs_review: "needs_review",
  conflict: "needs_review",
  incomplete: "incomplete",
  not_found: "incomplete",
};

export function allowedWorkflowActionsForRun(input: {
  status: RunStatus;
  outcome: Outcome | null;
}): readonly WorkflowActionType[] {
  if (input.status === "failed")
    return ["retry_processing", "download_summary"];
  if (input.status !== "completed" || input.outcome === null) return [];
  return actionsByOutcomeGroup[outcomeGroup[input.outcome]];
}

const rolesByFamily: Readonly<Record<DocumentFamily, readonly string[]>> = {
  supplier_invoice: ["Accounts Payable Analyst", "Buyer", "Supplier Contact"],
  warehouse_goods_receipt: ["Warehouse Lead", "Buyer", "Supplier Contact"],
};

const actionsRequiringRecipientRole = new Set<WorkflowActionType>([
  "assign_review",
  "request_clarification",
  "request_clearer_document",
  "prepare_email",
]);

export function workflowActionRequiresRecipient(
  action: WorkflowActionType,
): boolean {
  return actionsRequiringRecipientRole.has(action);
}
```

`assertRecipientRoleAllowed` requires one listed role for actions in `actionsRequiringRecipientRole`. It requires `recipientRole: null` for every other action so unused text is never retained.

Map `approve_and_stage` to `staged`, `prepare_email` to `prepared` and every other action to `simulated`.

Generate email copy with bounded evidence summaries:

```ts
export function createEmailPreview(input: {
  runId: string;
  outcome: Outcome;
  recipientRole: string;
  fields: readonly FieldResult[];
}): EmailPreview {
  const redactAddressLikeText = (value: string) =>
    value
      .replace(
        /(?:mailto:\S+|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b)/gi,
        "[address redacted]",
      )
      .replaceAll("@", "[at redacted]");
  const differences = input.fields
    .filter((field) => field.evaluatorStatus !== "pass")
    .map((field) =>
      redactAddressLikeText(
        `${field.label}: ${field.extractedValue ?? "Not found"}`,
      ),
    )
    .slice(0, 6);
  return {
    recipientRole: input.recipientRole,
    subject: `Prepared only - not sent | Document review ${input.runId}`,
    body: [
      `Prepared only - not sent`,
      `To role: ${input.recipientRole}`,
      `Run: ${input.runId}`,
      `Outcome: ${input.outcome.replaceAll("_", " ")}`,
      differences.length
        ? `Items requiring attention:\n${differences.join("\n")}`
        : "No discrepancies were recorded.",
    ].join("\n\n"),
    deliveryStatus: "prepared_only_not_sent",
  };
}
```

Move `redactAddressLikeText` to module scope in the implementation and bound its input through the existing public-text sanitizer before replacement. Use the redacted result in every subject or body fragment derived from run data. Recipient roles come from the server catalogue and the run ID has already passed the run-ID validator.

- [ ] **Step 5: Add strict Zod schemas**

Define `workflowActionTypeSchema`, `workflowEventStatusSchema`, `workflowEventSchema` and:

```ts
export const workflowActionRequestSchema = z
  .object({
    action: workflowActionTypeSchema,
    recipientRole: z.string().trim().min(1).max(80).nullable(),
  })
  .strict();
```

The handler will reject roles outside the server catalogue. No schema includes an email-address field.

- [ ] **Step 6: Run policy and schema tests**

```powershell
npx vitest run tests/unit/domain/workflow-actions.test.ts tests/unit/domain/run-schema.test.ts
```

Expected: PASS for all allowlists, statuses, role catalogues and prepared email copy.

- [ ] **Step 7: Commit the workflow domain**

```powershell
git add src/domain/types.ts src/domain/workflow-actions.ts src/domain/run-schema.ts tests/unit/domain/workflow-actions.test.ts tests/unit/domain/run-schema.test.ts
git commit -m "feat: define simulated workflow policy"
```

---

### Task 2: Persist idempotent workflow events

**Files:**

- Modify: `src/server/repositories/run-repository.ts`
- Modify: `src/server/http/public-serialization.ts`
- Modify: `tests/unit/server/run-repository.test.ts`
- Modify: `tests/contract/routes/public-serialization.test.ts`
- Modify: `tests/contract/persistence/document-workflow-migration.test.ts`

**Interfaces:**

- Produces: `CreateWorkflowEventInput`, `CreateWorkflowEventResult` and `RunRepository.createWorkflowEvent`.
- Produces: `PublicRunRecord.details.workflowEvents` ordered by `createdAt` then ID.
- Consumes: The `workflow_events` table created by Plan 1 Task 3.

- [ ] **Step 1: Write failing repository tests**

Test these behaviors with the in-memory repository:

```ts
const first = await repository.createWorkflowEvent({
  runId,
  action: "prepare_email",
  recipientRole: "Buyer",
  status: "prepared",
  now,
  eventId: "event_1",
});
const duplicate = await repository.createWorkflowEvent({
  runId,
  action: "prepare_email",
  recipientRole: "Buyer",
  status: "prepared",
  now,
  eventId: "event_2",
});
expect(first.status).toBe("created");
expect(duplicate).toMatchObject({
  status: "already_created",
  event: { id: "event_1" },
});
```

Repeat idempotence with `recipientRole: null`. Reuse `event_1` for a different run and identity then assert `id_collision`. Assert a failed run accepts `retry_processing` and `download_summary` but returns `unavailable` for `approve_and_stage`. Assert expired and deleted runs return their safe status. Assert active detail lists events and deleted or expired detail exposes none.

- [ ] **Step 2: Run repository tests and confirm failure**

```powershell
npx vitest run tests/unit/server/run-repository.test.ts tests/contract/routes/public-serialization.test.ts tests/contract/persistence/document-workflow-migration.test.ts
```

Expected: FAIL because repository event methods and public event serialization do not exist.

- [ ] **Step 3: Add repository contracts**

Add:

```ts
export type CreateWorkflowEventInput = {
  runId: string;
  action: WorkflowActionType;
  recipientRole: string | null;
  status: WorkflowEventStatus;
  now: Date;
  eventId: string;
};

export type CreateWorkflowEventResult =
  | { status: "created" | "already_created"; event: WorkflowEvent }
  | {
      status:
        | "not_found"
        | "unavailable"
        | "expired"
        | "deleted"
        | "id_collision";
    };
```

Add `createWorkflowEvent(input)` to `RunRepository`. Add `workflowEvents: WorkflowEvent[]` to internal run detail and active public detail.

- [ ] **Step 4: Implement in-memory idempotence and lifecycle behavior**

Use the identity:

```ts
function workflowIdentity(
  action: WorkflowActionType,
  recipientRole: string | null,
) {
  return `${action}\u0000${recipientRole ?? ""}`;
}
```

Store events by run and identity plus a global event-ID map. Return the existing event on identity duplicate. Return `id_collision` when `eventId` belongs to another identity. A completed run may reach insertion after handler policy validation. A failed run may insert only `retry_processing` or `download_summary`. Return `unavailable` for any other failed-run action or any non-terminal status. Clear events and their global ID entries in the same `clearDetails` path that removes fields and steps.

- [ ] **Step 5: Implement atomic Neon insertion**

Use one transaction-shaped CTE that locks the run, classifies lifecycle state and inserts with `ON CONFLICT DO NOTHING`. Then select either the inserted or existing identity:

```sql
WITH locked_run AS (
  SELECT id, status, expires_at, details_deleted
  FROM runs WHERE id = $1 FOR UPDATE
), classified AS (
  SELECT *, CASE
    WHEN details_deleted OR status = 'deleted' THEN 'deleted'
    WHEN expires_at <= $2::timestamptz THEN 'expired'
    WHEN status = 'failed' AND $4 IN ('retry_processing', 'download_summary') THEN 'available'
    WHEN status <> 'completed' THEN 'unavailable'
    ELSE 'available'
  END AS decision
  FROM locked_run
), inserted AS (
  INSERT INTO workflow_events (id, run_id, action, recipient_role, status, created_at)
  SELECT $3, id, $4, $5, $6, $2::timestamptz
  FROM classified WHERE decision = 'available'
  ON CONFLICT DO NOTHING
  RETURNING *
)
SELECT classified.decision, event.*
FROM classified
LEFT JOIN LATERAL (
  SELECT * FROM inserted
  UNION ALL
  SELECT * FROM workflow_events
  WHERE run_id = classified.id AND action = $4
    AND COALESCE(recipient_role, '') = COALESCE($5, '')
  LIMIT 1
) AS event ON true;
```

Hydrate `id_collision` when `classified.decision = 'available'` but neither the inserted row nor a row matching `(run_id, action, COALESCE(recipient_role, ''))` exists. Never report `created` without an event matching that identity.

Hydrate events only for active detail reads and detailed list requests. Order by `created_at, id`.

Extend the existing Neon tombstone CTE with:

```sql
removed_workflow_events AS (
  DELETE FROM workflow_events WHERE run_id = $1
)
```

Place it beside `removed_steps` and `removed_result` so early deletion and expiry purge physically remove the workflow timeline while anonymous run summaries survive.

- [ ] **Step 6: Serialize active events safely**

Add an allowlist serializer that bounds role text to 80 characters. Do not include events in expired or deleted DTOs. Preserve actual provider/model gating on `providerDispatched`.

- [ ] **Step 7: Run repository and serialization tests**

```powershell
npx vitest run tests/unit/server/run-repository.test.ts tests/contract/routes/public-serialization.test.ts tests/contract/persistence/document-workflow-migration.test.ts
```

Expected: PASS for both nullable and non-null idempotence, lifecycle denial and detail cleanup.

- [ ] **Step 8: Commit event persistence**

```powershell
git add src/server/repositories/run-repository.ts src/server/http/public-serialization.ts tests/unit/server/run-repository.test.ts tests/contract/routes/public-serialization.test.ts tests/contract/persistence/document-workflow-migration.test.ts
git commit -m "feat: persist simulated workflow events"
```

---

### Task 3: Add the capability-protected workflow route

**Files:**

- Create: `src/server/http/workflow-action-handler.ts`
- Create: `src/app/api/runs/[id]/workflow-actions/route.ts`
- Create: `tests/contract/routes/workflow-actions-route.test.ts`
- Modify: `src/server/http/stage-action-handler.ts`
- Modify: `tests/contract/routes/stage-action-route.test.ts`
- Modify: `src/server/http/metrics-handler.ts`

**Interfaces:**

- Produces: `POST /api/runs/[id]/workflow-actions`.
- Consumes: Capability verification, run detail, domain allowlists, role allowlists and repository event creation.
- Preserves: `POST /api/runs/[id]/stage-action` as an idempotent `approve_and_stage` compatibility route.

- [ ] **Step 1: Write failing route contract tests**

Cover:

```ts
expect(await postWorkflow({ capability: null })).toHaveProperty("status", 401);
expect(await postWorkflow({ capability: "wrong" })).toHaveProperty(
  "status",
  401,
);
expect(
  await postWorkflow({ action: "approve_and_stage", outcome: "needs_review" }),
).toHaveProperty("status", 409);
expect(
  await postWorkflow({
    action: "prepare_email",
    recipientRole: "Unknown Role",
  }),
).toHaveProperty("status", 400);
expect(await postRawWorkflow("{")).toHaveProperty("status", 400);
expect(await postWorkflow({ action: "send_email" as never })).toHaveProperty(
  "status",
  400,
);
expect(await postFailedWorkflow({ action: "retry_processing" })).toHaveProperty(
  "status",
  200,
);
expect(
  await postFailedWorkflow({ action: "approve_and_stage" }),
).toHaveProperty("status", 409);
```

For a valid clear run assert first request returns `created`, duplicate returns `already_created` and only one repository event exists. Inject an event-ID collision then assert a stable 503 `workflow_event_conflict` response with no event. For `prepare_email` assert response includes a preview with `deliveryStatus: "prepared_only_not_sent"` while repository event data has no subject or body.

Assert the abuse-control read limit runs before deletion-token hash lookup. Assert no email adapter or outbound tool is present in the handler dependencies.

- [ ] **Step 2: Run route tests and confirm failure**

```powershell
npx vitest run tests/contract/routes/workflow-actions-route.test.ts tests/contract/routes/stage-action-route.test.ts
```

Expected: FAIL because the workflow route is absent and stage action still mutates action JSON directly.

- [ ] **Step 3: Implement validation and policy order**

The handler order is:

```ts
validateRunId();
await abuseControl.allowPublicRead();
verifyBrowserCapability();
const parsedRequest = await parseWorkflowActionRequest(request);
if (!parsedRequest.success) return workflowRequestInvalidResponse();
const actionRequest = parsedRequest.data;
const run = await repository.readPublicRun(runId, now);
assertWorkflowDetailAvailable(run);
assertActionAllowed(
  allowedWorkflowActionsForRun({ status: run.status, outcome: run.outcome }),
  actionRequest.action,
);
assertRecipientRoleAllowed(
  run.documentFamily,
  actionRequest.action,
  actionRequest.recipientRole,
);
const result = await repository.createWorkflowEvent({
  runId,
  action: actionRequest.action,
  recipientRole: actionRequest.recipientRole,
  status: workflowStatusForAction(actionRequest.action),
  now,
  eventId: container.requestIdSource(),
});
```

Use stable public errors: `workflow_request_invalid`, `workflow_not_authorized`, `workflow_action_not_allowed`, `workflow_recipient_not_allowed`, `workflow_event_conflict`, `run_expired`, `run_deleted` and `workflow_unavailable`.

`parseWorkflowActionRequest` catches JSON syntax and Zod validation failures then takes the stable 400 `workflow_request_invalid` response path. It must not let malformed input reach the generic 503 catch. Map repository `id_collision` to 503 `workflow_event_conflict` so the browser can retry without claiming an event was written.

- [ ] **Step 4: Return prepared email without persistence**

For `prepare_email` require a completed run with result fields then call `createEmailPreview` using serialized run fields. Return:

```ts
{
  workflow: { status: result.status, event: result.event },
  emailPreview,
}
```

For other actions omit `emailPreview`. Invalidate metrics only when status is `created`.

- [ ] **Step 5: Map stage-action compatibility**

Refactor the stage handler to create `approve_and_stage` with null recipient role and `staged` status. Preserve the existing response envelope:

```ts
{
  staging: {
    status: result.status === "created" ? "staged" : "already_staged",
    action: { ...run.details.result.action, stagedAt: result.event.createdAt },
  },
}
```

Do not mutate `run_results.result_json.action.stagedAt` as the source of truth. Public serialization may derive legacy `stagedAt` from the event for compatibility.

Map `id_collision` to the existing safe 503 staging-unavailable response. Never return `already_staged` unless the selected event matches the same run plus `approve_and_stage` identity.

- [ ] **Step 6: Run route tests**

```powershell
npx vitest run tests/contract/routes/workflow-actions-route.test.ts tests/contract/routes/stage-action-route.test.ts tests/unit/server/metrics-handler.test.ts
```

Expected: PASS with idempotent events and no outbound behavior.

- [ ] **Step 7: Commit workflow routes**

```powershell
git add src/server/http/workflow-action-handler.ts src/app/api/runs/[id]/workflow-actions/route.ts src/server/http/stage-action-handler.ts src/server/http/metrics-handler.ts tests/contract/routes/workflow-actions-route.test.ts tests/contract/routes/stage-action-route.test.ts tests/unit/server/metrics-handler.test.ts
git commit -m "feat: add simulated workflow action endpoint"
```

---

### Task 4: Build outcome-specific actions and activity timeline

**Files:**

- Create: `src/components/workbench/workflow-panel.tsx`
- Create: `src/components/workbench/email-preview-dialog.tsx`
- Create: `src/components/workbench/activity-timeline.tsx`
- Modify: `src/components/workbench/workbench-view.tsx`
- Remove after migration: `src/components/workbench/action-card.tsx`
- Modify: `src/components/ui/dialog.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/component/workbench.test.tsx`
- Modify: `tests/e2e/workbench.spec.ts`
- Modify: `tests/e2e/reviewer-regressions.spec.ts`

**Interfaces:**

- Consumes: Active run outcome, action proposal, workflow events and browser-held capability.
- Produces: Outcome-specific primary and secondary controls, email preview and immediate activity timeline updates.
- Produces: `onReprocess` callback that reuses the normal Workbench submission path.

- [ ] **Step 1: Write failing component tests for each outcome**

Assert:

```ts
expect(
  clearView.getByRole("button", { name: "Approve and stage" }),
).toBeVisible();
expect(
  reviewView.getByRole("button", { name: "Assign for review" }),
).toBeVisible();
expect(
  incompleteView.getByRole("button", { name: "Request a clearer document" }),
).toBeVisible();
expect(
  failedView.getByRole("button", { name: "Retry processing" }),
).toBeVisible();
expect(
  failedView.getByRole("button", { name: "Download error summary" }),
).toBeVisible();
```

Click `Prepare email copy`, select `Buyer`, submit and assert the dialog shows `Prepared only - not sent` plus a copy button. Assert the timeline appends the returned event without a page reload.

Click `Assign for review` and `Request a clearer document` then assert each opens the same role chooser with no preselected role. Select one allowed role and assert the route receives it. Assert the request cannot submit while the role is empty.

For `Retry processing` assert the old event is recorded then `onReprocess` is called once. Do not assert a provider call inside the workflow component.

For `Download review summary` assert `POST /workflow-actions` returns a `download_summary` event before `URL.createObjectURL` is called. For `Replace document and reprocess` assert `replace_document` is persisted before `onRequestReplacement` opens the system picker. Assert no new processing run begins until the user selects and submits a replacement file through the normal path.

- [ ] **Step 2: Run the Workbench component test and confirm failure**

```powershell
npx vitest run tests/component/workbench.test.tsx
```

Expected: FAIL because only `Stage action` exists.

- [ ] **Step 3: Implement workflow controls from domain policy**

Use:

```ts
export function WorkflowPanel(props: {
  runId: string;
  status: RunStatus;
  outcome: Outcome | null;
  proposal: ActionProposal | null;
  events: readonly WorkflowEvent[];
  capabilityToken: string;
  documentFamily: DocumentFamily | null;
  onEvent: (event: WorkflowEvent) => void;
  onReprocess: () => void;
  onRequestReplacement: () => void;
}): React.JSX.Element;
```

Render controls from `allowedWorkflowActionsForRun({ status, outcome })`. A failed run renders `Retry processing` as primary plus `Download error summary` and the existing safe diagnostic as secondary content. It never renders approval, email or assignment. Disable every mutation while its request is pending. Send the capability only through `x-run-capability` and never place it in a URL.

- [ ] **Step 4: Implement role selection and prepared email preview**

When `workflowActionRequiresRecipient(action)` is true render role selection from `allowedRecipientRoles` in an accessible dialog with no default selection. Disable confirmation until one allowed role is selected. After a non-email route succeeds close the dialog and append the event. After `prepare_email` succeeds keep the dialog open then show subject and body in read-only fields. The only message-delivery control is `Copy prepared message`. Do not render `Send`, `mailto:` or an address input.

- [ ] **Step 5: Implement the timeline**

Display events chronologically with these labels:

```ts
const workflowLabels = {
  approve_and_stage: "Internal staging prepared",
  mark_for_later_review: "Marked for later review",
  assign_review: "Manual review assigned",
  request_clarification: "Clarification request prepared",
  request_clearer_document: "Clearer-document request prepared",
  prepare_email: "Email copy prepared - not sent",
  replace_document: "Replacement requested",
  retry_processing: "Reprocessing requested",
  download_summary: "Summary prepared",
} satisfies Record<WorkflowActionType, string>;
```

Every entry includes timestamp, status and recipient role when present.

- [ ] **Step 6: Wire retry and download behavior**

For a current synthetic result `onReprocess` calls the existing `runAssurance` after the `retry_processing` event succeeds. For a current custom result allow reprocess only while the browser still holds the selected `File`; otherwise call `onRequestReplacement` and explain that a replacement is required.

For `replace_document` first persist the event then call `onRequestReplacement`, which selects the custom source and activates the `+ Add your document` file input. The replacement is validated and processed only after the normal consent plus `Process document` interaction. Never automatically reuse the old file for a replacement action.

For a completed-run download first persist `download_summary` then create a UTF-8 text Blob containing run ID, outcome, fields and `Prepared summary - simulated workflow`. For a failed-run download first persist the same action then include run ID, safe diagnostic codes and `Error summary - simulated workflow`. Append the returned event before invoking the browser download. Revoke the object URL immediately after the click.

- [ ] **Step 7: Run component and browser tests**

```powershell
npx vitest run tests/component/workbench.test.tsx
npx playwright test tests/e2e/workbench.spec.ts tests/e2e/reviewer-regressions.spec.ts
```

Expected: PASS for every outcome, prepared email, timeline, retry and download behavior.

- [ ] **Step 8: Commit the workflow interface**

```powershell
git add src/components/workbench/workflow-panel.tsx src/components/workbench/email-preview-dialog.tsx src/components/workbench/activity-timeline.tsx src/components/workbench/workbench-view.tsx src/components/ui/dialog.tsx src/app/globals.css tests/component/workbench.test.tsx tests/e2e/workbench.spec.ts tests/e2e/reviewer-regressions.spec.ts
git rm src/components/workbench/action-card.tsx
git commit -m "feat: add outcome-based document workflow"
```

---

### Task 5: Verify workflow safety and compatibility

**Files:**

- Modify: `docs/architecture.md`
- Modify: `docs/privacy-and-retention.md`
- Modify: `README.md`
- Modify: `tests/contract/routes/security-headers.test.ts`

**Interfaces:**

- Consumes: Completed workflow implementation.
- Produces: Documented simulation boundary and a green regression baseline.

- [ ] **Step 1: Add failing safety assertions**

Assert route responses have `no-store` and `noindex` headers. Search source and public bundles for forbidden controls:

```ts
expect(source).not.toMatch(/mailto:|send email|recipient email/i);
expect(source).toMatch(/Prepared only - not sent/i);
```

- [ ] **Step 2: Run safety tests and confirm failure before documentation and headers are complete**

```powershell
npx vitest run tests/contract/routes/security-headers.test.ts tests/contract/routes/workflow-actions-route.test.ts
```

Expected: FAIL until the new route is included in the security-header matrix.

- [ ] **Step 3: Document the workflow boundary**

State that events represent user intent and preparation only, role names are synthetic, email content is not retained and no external connector is present.

- [ ] **Step 4: Run the workflow regression suite**

```powershell
npm run lint
npm run typecheck
npx vitest run tests/unit/domain/workflow-actions.test.ts tests/unit/server/run-repository.test.ts tests/contract/routes/workflow-actions-route.test.ts tests/contract/routes/stage-action-route.test.ts tests/component/workbench.test.tsx
npx playwright test tests/e2e/workbench.spec.ts tests/e2e/reviewer-regressions.spec.ts
npm run build:production
```

Expected: every command exits 0.

- [ ] **Step 5: Commit workflow documentation**

```powershell
git add README.md docs/architecture.md docs/privacy-and-retention.md tests/contract/routes/security-headers.test.ts
git commit -m "docs: document simulated workflow boundary"
```
