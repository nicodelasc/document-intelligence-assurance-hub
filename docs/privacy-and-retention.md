# Privacy and retention

## Public prototype boundary

A custom upload is voluntary and its public-safe run metadata and extracted evidence can appear in the public Workbench or Operations view while active. Do not submit personal data, confidential business data, credentials, regulated records or material covered by a client agreement.

Synthetic fixtures are the recommended review path.

## Retention behavior

Runs expire 23 hours and 55 minutes after creation. An expired document read is denied even if the scheduled purge has not run yet.

Delete now requires the one-time raw deletion token returned in the terminal stream. The browser stores this capability locally for the active receipt. The server persists only its hash. Guessing or replaying the token does not restore access.

Deletion and expiry use the following order:

1. Mark details deleted in the repository.
2. Remove traces, results, labels, document locator and deletion hash from active access.
3. Record a durable physical cleanup job when a Blob object exists.
4. Attempt Blob deletion.
5. Retry failed Blob cleanup through the hourly purge.

Logical access denial is immediate. Physical cleanup can lag when Blob is unavailable. The tombstone remains the access-control boundary during that delay.

## Storage boundary

Connected document storage is private Vercel Blob. Objects are never linked directly to a public client. The app serves active bytes only through a same-origin route with no-store and cross-origin protection headers.

Neon stores run state, public-safe trace data, quota reservations, idempotency claims and cleanup jobs. Environment credentials remain server-side.

## Enterprise gaps

This prototype does not provide authentication, private per-user run visibility, tenant isolation, malware scanning, data-loss prevention, legal hold, regional policy enforcement, audit export or a formally approved retention policy. Those controls are required before sensitive enterprise use.
