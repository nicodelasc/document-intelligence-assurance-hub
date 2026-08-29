# UX Contract

## Product context

- Audience: A headquarters interviewer assessing a public-safe AI automation prototype.
- Primary jobs: Run guided samples, prepare safe actions, compare two runs and inspect evidence and operational signals.
- Target market: Portfolio review for a Singapore regional role.
- Active locale: `en-SG`.
- Language/content register and review policy: Plain operational English with conservative claims and source-controlled experience framing.
- Timezone/calendar policy: Store UTC instants and display timezone labels. Use Gregorian dates.
- Accessibility target: WCAG 2.2 AA.

## Business-context sources

| Domain / scope | Authoritative source | Source type | Reviewed date |
|---|---|---|---|
| Product behavior | `docs/superpowers/specs/2026-08-27-document-intelligence-assurance-hub-design.md` | Approved product specification | 2026-08-27 |
| Document operations redesign | `docs/superpowers/specs/2026-08-29-document-operations-workflow-redesign.md` | Approved redesign specification | 2026-08-29 |
| Experience and claim boundaries | Local claim-controlled resume and workbook named in the specification | Approved source artifacts | 2026-08-27 |
| Data lifecycle | Approved 24-hour public upload requirement in the specification | Product specification | 2026-08-27 |
| Deletion and retention | Approved early-delete token and hourly expiry cleanup requirement | Product specification | 2026-08-27 |
| Billing and payment | Out of scope | Product specification | 2026-08-27 |
| Legal and regulatory copy | Prototype warning from the approved specification | Product specification | 2026-08-27 |

## Visual contract

- Project `DESIGN.md`: `DESIGN.md`.
- Token ownership model: Runtime CSS is canonical and `DESIGN.md` mirrors accepted values.
- Runtime design-system/token source: `src/app/globals.css`.
- Mapping and adapters: CSS variables consumed by shared components in `src/components/ui`.
- Token drift gate: DESIGN lint, premium audit and screenshot fidelity ledger.
- Supported themes: Light only for this portfolio version.
- Design-context owner/review policy: Update design documentation and runtime tokens in the same change.

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Table Selection | `RunExplorer` radio-row selection | This contract | one selected run | component and E2E |
| Select/Listbox | Grouped native model select with accepted platform popup | `/api/models` and this contract | native | keyboard and browser |
| Tabs | `FixtureLibrary` document-family tablist | This contract | Supplier invoices and Warehouse goods receipts | Arrow keys, Home, End and browser |
| Form | Shared labeled field components with Zod adapters | This contract | run and calculator | validation E2E |
| Scrollbar | Global application stylesheet | `DESIGN.md` | stable-gutter geometry | computed style |
| Toast | Shared polite status region | This contract | success, warning, info and error | live-region test |
| CRUD | Run routes and deletion dialog | API contract and this file | create, read and delete | full-flow E2E |

## Component behavior

| Component | Default | Hover | Focus | Active | Disabled | Busy | Error |
|---|---|---|---|---|---|---|---|
| Button | Intent style | Stronger border | 2 px focus ring | Pressed tone | Muted and inert | Stable spinner | Inline recovery |
| Icon button | Named outline control | Surface tint | 2 px focus ring | Pressed tone | Muted and inert | Stable spinner | Inline recovery |
| Input | Labeled rule | Darker rule | Focus ring | n/a | Muted and inert | Read-only during submit | Text plus `aria-invalid` |
| Search | Clear when non-empty | Darker rule | Focus ring | n/a | Muted and inert | Reserved spinner | Persistent status |
| Table/list | Ruled rows | Surface tint | Visible row control | Selected rail | n/a | Stable overlay | Retry row |

## Dataset navigation

- Admin tables: Server-ready pagination with a bounded recorded dataset in keyless mode.
- URL state: Run filter, selected run and page belong in URL search parameters when changed by the reviewer.
- Page size: 10 rows.
- Empty/no-results/error/loading treatment: Stable run ledger footprint with distinct copy and retry where safe.
- Back/scroll restoration: URL state and native browser restoration.
- Selection scope: One run for exploration. Comparison uses exactly two explicit run selections.

## Flow ledger

| Operation | Trigger | Pending | Success destination | Success feedback | Failure recovery | Focus outcome | Source ref |
|---|---|---|---|---|---|---|---|
| Create run | `Process document` | Streamed stage rail | Same Workbench | Final result and status announcement | Safe error and replay option | Outcome heading | Product specification |
| Stage prepared action | `Stage action` | Pessimistic busy button | Same Workbench | Server-returned staged state | Preserve proposal and retry | Action status | Product specification |
| Compare runs | `Compare runs` | Stable inline loader | Same Workbench | Difference table | Preserve selections and retry | Comparison heading | Product specification |
| Delete run | `Delete now` | Dialog action busy | Run list | `Run deleted` status | Dialog remains open with safe error | Next run or list heading | Product specification |
| Search runs | Search input | Stable ledger loader | Same Operations route | Result count | Clear and retry | Search or results heading | Product specification |
| Upload/background job | `Process document` | Three named progress groups | Same Workbench | Prepared action, evidence and private deletion token | Cancel, retry or synthetic sample | Current stage or outcome | Product specification |
| Cancel/back | `Cancel run` or route link | Stop pending client request | Same route or chosen route | Neutral cancellation status | Preserve selected source | Originating control | Product specification |
| Hard-delete | `Delete now` | Danger dialog busy | Active runs list | Deleted status | Retry with same token | Next logical run | Product specification |

## Navigation and responsive behavior

- Route document title policy: `{Page} — Document Intelligence Assurance Hub`.
- Route error behavior: App-owned not-found and safe server error pages keep route navigation available.
- Route-state policy: Workbench and Operations are bookmarkable routes. Operations selection is URL-backed.
- Responsive transformation: Workbench library, preview and trace stack in that order. Family tabs and the five active variants stack without horizontal page overflow at 390 px. The actual PDF iframe keeps stable geometry and `What changed` moves below it. The prepared action remains before the evidence ledger. Operations metrics wrap while the run table scrolls horizontally.
- Truncation/full-value access: Important evidence wraps. Long IDs provide a labeled copy control.
- Focus restoration and sticky-obstruction policy: Sticky regions use `scroll-margin` and never cover focused controls.

## Overlays and feedback

- Dialog primitive: Shared accessible dialog with inert backdrop, Escape close and focus restoration.
- Destructive confirmation levels: Early deletion is irreversible for detailed public data and uses danger intent with explicit consequence.
- Toast placement/duration/deduplication: One top-right polite region. Critical corrections remain inline.
- Alert/banner scope and persistence: Upload consent is persistent for custom documents. `Sample results - no AI processing` appears only for a recorded fixture on an unavailable route. An unavailable custom route instead shows `Processing unavailable for this model`.
- Tooltip delay/dismissal: Supplemental only and dismissible with Escape.
- Layer contract: dialog above popover above toast above sticky content.

## Async and resilience

- Mutation default: Pessimistic.
- Idempotency and duplicate-submit policy: Client run identifier and server guard prevent duplicate run submissions. Action staging is pessimistic and ignores duplicate clicks while the server operation is pending. Ready and review-required actions may stage while blocked actions may not. A repeated authorized server request returns the existing staged state.
- Offline/read-stale/write behavior: Recorded samples remain readable. Live custom submission reports connectivity failure and preserves inputs.
- Retry/backoff/timeout behavior: One retry only for provider 429 or 5xx errors and no silent provider switch.
- Long-running progress and return path: Named stages stream to the active Workbench. Live announcements use only the three grouped stage names and suppress duplicates. Terminal failure settles the active visible group.
- Stale-request policy: Abort or request identifiers stop old responses from replacing current state. Source controls and model selection remain disabled during validation and execution. Completion ends cancellation before prepared-action detail loading starts.
- Dialog/form preservation: Errors preserve safe values and selected files until removal or retry.

## Validation

- Schema layer: Shared Zod schemas on client boundaries and server routes.
- Trigger timing: Submit first then change or blur for invalid fields.
- Error policy: Inline field text plus a form-level alert for global failure.
- Server mapping: Public safe error code and message only.
- Sensitive-value handling: API keys and deletion-token hashes never reach the client. The raw run capability is sent only in a private request header for staging. Custom-upload deletion receipts are shown once to the uploader.
- Submission policy: `noValidate`, first-invalid focus and duplicate-submit prevention.

## Verification

- Required static commands: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm verify:premium` and `pnpm build`.
- Browser matrix: Chromium desktop 1440x1000 and mobile 390x844 with reduced motion.
- Accessibility checks: axe scan, keyboard route and form use plus live-region status.
- Component-state coverage: Two-family keyboard tabs, five variants per family, classification icon and text, actual PDF preview, direct native file picker, grouped model selection, conditional unavailable-provider feedback, custom incomplete-evidence wording, three-stage trace, action staging, errors, empty history, run selection, comparison and deletion dialog.
- Canonical sibling flow used for comparison: Workbench run ledger compared with Operations run explorer.
- CRUD full-flow evidence: `tests/e2e/workbench.spec.ts`.
- Failure-path evidence: `tests/e2e/failure-and-delete.spec.ts`.

