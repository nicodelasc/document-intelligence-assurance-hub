# Document Intelligence Assurance Hub Design Specification

## Purpose

Build a public-safe portfolio application that demonstrates document extraction, field-level evaluation, deterministic comparison, operational telemetry and responsible AI safeguards. The application is inspired by approved experience but is a new prototype. It must not reproduce a Kyndryl client solution or imply production ownership.

## Public routes

`/workbench` guides a reviewer through three synthetic invoices or one custom PDF, PNG or JPG upload. Custom files are limited to 3 MB and PDF files to five pages. The uploader must request exactly two or three fields and actively consent to the raw file and results being publicly visible for less than 24 hours.

`/operations` exposes prototype metrics, complete active traces, provider usage, synthetic benchmark quality, retention status, a run explorer and an illustrative resource calculator.

## Processing contract

One run uses either OpenAI GPT-5 mini or Anthropic Claude Haiku 4.5. It streams these steps in order: Validate, Store, Extract, Verify each field in parallel, Compare with reference data, Decide and Publish telemetry. A provider may retry once after a 429 or 5xx response. A run never changes provider silently.

Guided outcomes are `clear`, `needs_review` and `incomplete`. Custom outcomes are `evidence_consistent`, `conflict` and `not_found`. Custom outcomes describe document evidence and never approve a business action.

When credentials, budget or quota are unavailable the application serves clearly labeled recorded replays. Recorded runs are not represented as live model calls.

## Data and privacy contract

Documents use private Vercel Blob storage in connected environments. Active documents are served only through application routes with `Cache-Control: no-store`. Neon Postgres stores run metadata, step traces and structured results. Detailed data expires before 24 hours while anonymous aggregate records survive cleanup.

An uploader receives one raw deletion token. Only its hash is stored. The token can permanently remove the file and detailed trace before normal expiry.

No client dataset, client name, internal prompt, confidential metric, API key, raw deletion token, hidden reasoning or full system prompt may enter public traces or logs.

## Security contract

Document content is untrusted data. It cannot alter the extraction instruction or cause tool use. Models receive no tools and can take no external action. Server-side checks validate file signatures, file size, page count, field count, labels and normalized results. Public strings are rendered as text and never as untrusted HTML.

Anonymous limits are three custom uploads and six live runs per UTC day. The default global daily model budget is US$5 and a server-side kill switch can close live traffic. The budget reserves two full-context attempts at the selected model's dated rates and output cap. The cron cleanup route requires `CRON_SECRET` outside local tests.

## Resource scenario

The calculator uses editable SGD assumptions. Defaults are 200 documents each month, three fields per document, two manual minutes per field, 0.5 assisted minutes per field and S$50 loaded hourly cost. Every result is labeled illustrative rather than measured.

## Visual and accessibility contract

The accepted concepts are `docs/design/concepts/workbench-concept.png` and `docs/design/concepts/operations-concept.png`. `DESIGN.md` owns the durable visual rationale while `UX-CONTRACT.md` owns shared behavior. The UI targets WCAG 2.2 AA, keyboard use, screen-reader status announcements, reduced motion, mobile stacking and visible document-table overflow.

## Acceptance gate

The keyless application must pass unit, contract, accessibility, E2E, security, type, lint and production build checks. Final live acceptance still requires one real OpenAI run, one real Anthropic run, a deliberate failure and an expiry simulation. Those live checks must not run until Nicholas explicitly authorizes credential creation or use.

