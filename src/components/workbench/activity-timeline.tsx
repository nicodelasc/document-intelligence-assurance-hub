import type {
  WorkflowActionType,
  WorkflowEvent,
  WorkflowEventStatus,
} from "@/domain/types";

export const workflowLabels = {
  approve_and_stage: "Posting handoff prepared",
  mark_for_later_review: "Marked for later review",
  assign_review: "Manual review assigned",
  request_clarification: "Clarification request prepared",
  request_clearer_document: "Clearer-document request prepared",
  prepare_email: "Email copy prepared - not sent",
  replace_document: "Replacement requested",
  retry_processing: "Reprocessing requested",
  download_summary: "Summary prepared",
} satisfies Record<WorkflowActionType, string>;

const statusLabels: Record<WorkflowEventStatus, string> = {
  prepared: "Prepared",
  staged: "Staged internally",
  simulated: "Simulated",
};

function sortEvents(events: readonly WorkflowEvent[]): WorkflowEvent[] {
  const byId = new Map(events.map((event) => [event.id, event]));
  return [...byId.values()].sort((left, right) => {
    const byTimestamp = left.createdAt.localeCompare(right.createdAt);
    return byTimestamp === 0 ? left.id.localeCompare(right.id) : byTimestamp;
  });
}

function displayTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat("en-SG", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Asia/Singapore",
  }).format(new Date(timestamp));
}

export function ActivityTimeline({
  events,
}: {
  events: readonly WorkflowEvent[];
}) {
  if (events.length === 0) {
    return (
      <p className="workflow-activity-empty">
        Prepared case activity will appear here.
      </p>
    );
  }

  return (
    <ol className="workflow-activity-list" aria-label="Workflow activity">
      {sortEvents(events).map((event) => (
        <li key={event.id}>
          <div>
            <strong>{workflowLabels[event.action]}</strong>
            <span>{statusLabels[event.status]}</span>
          </div>
          {event.recipientRole ? (
            <span>Role: {event.recipientRole}</span>
          ) : null}
          <time dateTime={event.createdAt}>
            {displayTimestamp(event.createdAt)} SGT
          </time>
        </li>
      ))}
    </ol>
  );
}
