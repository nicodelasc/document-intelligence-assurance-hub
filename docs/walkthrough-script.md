# Two-minute walkthrough

Use the real Workbench and Operations routes. Demo mode must remain visible throughout this walkthrough.

The repository includes [the 2:03 recorded walkthrough](../artifacts/walkthrough.webm) at 1440×900. It was captured from the stable public keyless deployment on 2026-08-28. On-screen chapter captions make the artifact usable without narration and disclose that no provider request occurred.

## 0:00–0:25 — Catalogue and deterministic boundary

Open Workbench. Show the grouped catalogue with GPT-5.6 Luna, GPT-5.6 Terra, Claude Haiku 4.5 and Claude Sonnet 5. Point out `Demo data — no provider call`. Explain that model selection is configuration only in this walkthrough and no provider request occurs.

## 0:25–0:55 — Ready action and private staging capability

Choose Warehouse receiving sheet then run the assurance check. Follow Understand document, Verify evidence and Resolve and prepare action. Show the Clear outcome and ready inventory-receipt proposal. Stage the action then explain that the browser-held run capability authorizes one idempotent internal dry-run event.

## 0:55–1:20 — Review-required action

Choose Invoice exception packet. Show the conflicting total, handwritten hold instruction and Needs review outcome. Point out that the accounts-payable exception proposal does not approve a payment or contact a business system.

## 1:20–1:42 — Operations action evidence

Open Operations. Show ready, needs-review, blocked and staged dry-run counts. Read the population statement: the latest 100 runs are inspected and active details expire within 24 hours. Open the staged warehouse run then show action type, policy status, staged timestamp and Diagnostics. Provider and model execution must read `Not called (demo)`.

## 1:42–1:52 — Blocked action and connector guarantee

Return to Workbench and choose Visitor access request. Show the missing sponsor approval evidence and blocked security-review proposal. State that no action path has tools or an ERP, ticketing, payment, inventory or access-control connector.

## 1:52–2:00 — Disclosure and gate

Close by stating that demo mode made no model request. The resource calculator remains illustrative and is not measured business impact. Live direct OpenAI and Anthropic integration is disabled by default. Live provider acceptance remains pending explicit key authorization and production verification.

## Portable recording command

Start the app or supply a reviewed deployment URL then run:

```bash
npm run record:walkthrough -- --base-url http://127.0.0.1:3100 --output artifacts/walkthrough.webm
```

The helper creates the parent artifact directory and records the browser workflow. Review the generated artifact against this script before publication because the committed recording helper may lag the current document catalogue. It does not contain a credential or personal filesystem path.
