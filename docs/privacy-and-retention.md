# Privacy and retention

## Public upload boundary

A custom upload is voluntary and its public-safe run metadata and extracted evidence can appear in the public Workbench or Operations view while active. Do not submit personal data, confidential business data, credentials, regulated records or material covered by a client agreement.

Synthetic fixtures are the recommended review path.

## Source-origin privacy boundary

The server labels results `Original demo document`, `Exact copy of a demo document` or `Source unverified`. Exact SHA-256 matching proves byte equality with a committed synthetic sample only. It does not prove authorship, authenticity, fraud status or malware safety. Digests, matched fixture identifiers and manifest entries stay server-side and are never public run fields.

Screenshots, re-encodings, edits and unrelated supported files are processed as `Source unverified`. They are not rejected by origin classification. Their extracted evidence may remain visible until expiry or deletion but a person must review the result before any posting handoff. Server-owned action policy prevents an unverified run from preparing a posting handoff.

## Retention behavior

Runs expire 23 hours and 55 minutes after creation. An expired document read is denied even if the scheduled purge has not run yet.

Delete now requires the one-time raw deletion token returned in the terminal stream. The browser stores this capability locally for the active receipt. The server persists only its hash. Guessing or replaying the token does not restore access.

Deletion and expiry use the following order:

1. Mark details deleted in the repository.
2. Remove traces, results, workflow events, labels, document locator and deletion hash from active access.
3. Record a durable physical cleanup job when a Blob object exists.
4. Attempt Blob deletion.
5. Retry failed Blob cleanup through the hourly purge.

Logical access denial is immediate. Physical cleanup can lag when Blob is unavailable. The tombstone remains the access-control boundary during that delay. Document reads recheck the tombstone and expiry after Blob retrieval before returning bytes.

## Aggregate retention boundary

Repository-wide anonymous aggregates survive detailed-data tombstoning so Operations can retain total, completion, review and failure counts without restoring document access. The repository-wide source-origin aggregate retains counts for original demo runs, exact-copy uploads and unverified uploads without exposing any digest or manifest entry. Repository-wide lifecycle metrics inspect only currently active detail and the cleanup backlog. The newest 100 public run summaries supply the Procurement review queue, Triage status, Prepared case handoffs, processing performance and review-record rows while those details remain active.

At expiry or Delete now traces, results, document locators and workflow events are removed from active access. Repository-wide aggregate projections do not expose filenames, evidence, field values, event IDs, run IDs, recipient roles, deletion capabilities, anonymous bucket values or reservation identifiers.

The newest 100 public run summaries are a separate bounded detail projection and do include run IDs so a reviewer can select an explorer row. Each latest workflow projection includes the action, status and timestamp. It omits the event ID and recipient role.

Confirmed completed cost metrics contain aggregate model usage only when a provider was dispatched and trustworthy token usage was recorded. Quota settlement and active reservations remain separate accounting populations. A failed dispatched request can settle conservatively without appearing as a completed model run.

## Storage boundary

Connected document storage is private Vercel Blob. Objects are never linked directly to a public client. The app serves active bytes only through a same-origin route with no-store and cross-origin protection headers. The document route permits framing by the same application origin only while ordinary pages deny framing.

Neon stores run state, public-safe trace data, workflow-event metadata, quota reservations, idempotency claims and cleanup jobs. Environment credentials remain server-side.

Workflow actions require the browser-held run capability and server-owned status, outcome and recipient-role policy. Recipient roles are synthetic business-role labels rather than addresses. No route accepts or stores a recipient address. The capability is not a user account or a private tenant boundary.

Workflow events record simulated user intent and preparation only. Neon retains the event and run identifiers, action type, optional synthetic role, status and timestamp. Prepared email subject and body are generated on demand, returned only in the no-store response and never persisted. The preview is `Prepared only - not sent`. The browser may copy the prepared text but the application cannot send it.

The server-owned four-model catalogue contains GPT-5.6 Luna, GPT-5.6 Terra, Claude Haiku 4.5 and Claude Sonnet 5. GPT-5.6 Luna and Claude Haiku 4.5 are the recommended defaults. Demo results are deterministic fixture data. Catalogue selection does not call a provider. One deliberate reviewer click on `Run live document review` is the paid-call boundary. The recorded button is `Assess sample without AI processing`. Operations labels non-dispatched rows `No AI processing`. Local acceptance is mocked. Six controlled production requests were dispatched with zero provider retries: five used OpenAI GPT-5.6 Luna and one used Anthropic Claude Haiku 4.5. After four fail-closed OpenAI observations exposed and helped correct selection plus OCR bundle defects the original PDF completed OpenAI `Clear` and an unverified PNG completed Anthropic `Conflict`. Conservative settled spend is US$0.0128216. Connected evidence now covers these two bounded provider routes. The custom result remained review-only and no external action occurred.

No external connector exists in this application. A simulated workflow event or prepared email copy is not evidence that an email, ERP, ticketing, payment, inventory or access-control action occurred.

Live synthetic processing with handwritten fixtures uses explicit text-and-visual grounding inside the application. Every validated text-native PDF page is rendered for bounded local OCR then native text and OCR text are merged for page-scoped evidence checks. PNG, JPEG and scanned PDF pages use local OCR with bundled English language data. Raw document bytes and full extracted page text are not sent to a separate OCR service. Full page text is held only for the active workflow and is not persisted or exposed. Public traces keep only the bounded evidence snippet returned for each requested field.

## Enterprise gaps

This application does not provide authentication, private per-user run visibility, tenant isolation, malware scanning, data-loss prevention, legal hold, regional policy enforcement, audit export or a formally approved retention policy. Those controls are required before sensitive enterprise use.
