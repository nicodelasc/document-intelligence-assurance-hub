# Privacy and retention

## Public upload boundary

A custom upload is voluntary and its public-safe run metadata and extracted evidence can appear in the public Workbench or Operations view while active. Do not submit personal data, confidential business data, credentials, regulated records or material covered by a client agreement.

Synthetic fixtures are the recommended review path.

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

## Storage boundary

Connected document storage is private Vercel Blob. Objects are never linked directly to a public client. The app serves active bytes only through a same-origin route with no-store and cross-origin protection headers. The document route permits framing by the same application origin only while ordinary pages deny framing.

Neon stores run state, public-safe trace data, workflow-event metadata, quota reservations, idempotency claims and cleanup jobs. Environment credentials remain server-side.

Workflow actions require the browser-held run capability and server-owned status, outcome and recipient-role policy. Recipient roles are synthetic business-role labels rather than addresses. No route accepts or stores a recipient address. The capability is not a user account or a private tenant boundary.

Workflow events record simulated user intent and preparation only. Neon retains the event and run identifiers, action type, optional synthetic role, status and timestamp. Prepared email subject and body are generated on demand, returned only in the no-store response and never persisted. The browser may copy the prepared text but the application cannot send it.

The server-owned four-model catalogue contains GPT-5.6 Luna, GPT-5.6 Terra, Claude Haiku 4.5 and Claude Sonnet 5. Demo results are deterministic fixture data. Catalogue selection does not call a provider. Operations labels non-dispatched rows `No AI processing`. Provider acceptance has not been completed or claimed.

No external connector exists in this application. A simulated workflow event or prepared email copy is not evidence that an email, ERP, ticketing, payment, inventory or access-control action occurred.

Live evidence grounding runs inside the application. Text-native PDF text is extracted locally while PNG, JPEG and scanned PDF pages use local OCR with bundled English language data. Raw document bytes and full extracted page text are not sent to a separate OCR service. Full page text is held only for the active workflow and is not persisted or exposed. Public traces keep only the bounded evidence snippet returned for each requested field.

## Enterprise gaps

This application does not provide authentication, private per-user run visibility, tenant isolation, malware scanning, data-loss prevention, legal hold, regional policy enforcement, audit export or a formally approved retention policy. Those controls are required before sensitive enterprise use.
