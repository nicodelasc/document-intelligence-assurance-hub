# Two-minute walkthrough

Use the real Workbench and Operations routes with provider keys absent. The fallback boundary must remain visible throughout this walkthrough. Finance and warehouse teams manually review supplier invoices and goods receipts before payment or inventory posting. The Hub prepares evidence and a controlled human handoff before downstream posting.

The repository includes [the current recorded walkthrough](../artifacts/walkthrough.webm) at 1440×900. Its measured duration is 2:07.28. It was regenerated from the two-family interface with `AI_LIVE_ENABLED=false`. On-screen chapter captions make the artifact usable without narration and state the non-execution boundaries. Provider acceptance is not established by this artifact.

## 0:00–0:15 — Two document families and the keyless boundary

Open Workbench at `Review incoming procurement documents`. Show `Supplier invoices` and `Warehouse goods receipts` with five fixtures in each family. Explain that these fixtures form 10 provider-neutral observations. Show the native `Processing model` selector then point out `Sample results - no AI processing`. Browsing fixtures and changing the model selection do not start processing.

## 0:15–0:30 — One correct fixture and three visible stages

Under Supplier invoices choose `Clean match` then press `Assess for exceptions`. Follow `Understand document`, `Verify evidence` and `Triage exception and prepare handoff`. Show `Review result`, the `Ready for posting review` outcome and `Prepare posting handoff` under `Prepared next step`. Also show `No AI processing` attribution. The selected model is configuration while persisted confirmed dispatch is the only provider-call evidence.

## 0:30–1:01 — Discrepancy and prepared simulated workflow action

Choose `Total mismatch`, select Claude Haiku 4.5 through `Processing model` then press `Assess for exceptions`. Show the conflicting invoice total and `Exception review required` outcome. Point out the scoped `Assign exception review` and `Draft clarification request` controls. Open `Draft clarification request`, leave Recipient role blank long enough to show the disabled control then select Buyer and choose `Prepare request`. Show `Prepared only - not sent` and the prepared activity entry. The prepared copy is response-only and no external connector receives it.

## 1:01–1:13 — Run comparison

Use `Run A` and `Run B` to compare the correct and discrepancy runs. Show requested fields, evidence, outcome, selected configuration and truthful provider attribution side by side.

## 1:13–1:36 — Queue-first procurement review operations

Open `Procurement review operations`. Show `Procurement review queue` before `Triage status`, `Processing performance` and `Reference quality suite`. The queue leads with document reference, document type, review decision, exception, prepared next step and received time. Select a record then open `Review record and technical trace` to show run ID, model, token, latency, expiry, safe diagnostics and `No AI processing` without inferring a provider call from selected configuration. State that the Reference quality suite contains 10 provider-neutral observations with five Supplier invoices and five Warehouse goods receipts.

## 1:36–1:58 — Costs workspace

Open `Costs workspace`. Show `US$0.00` settled and completed estimates plus `No confirmed model runs`. Open `Illustrative resource scenario`, show the SGD inputs and change Documents each month. Every result remains illustrative rather than measured impact.

## 1:58–2:08 — Disclosure and gate

Close with the complete boundary: All documents and reference records are synthetic. The extraction, comparison, evaluator safeguards and workflow preparation are functional. ERP posting, payment, inventory, email and archive integrations are simulated and no external business system is changed. This walkthrough made no model request. Provider acceptance is not established and requires a separately authorized credential session.

## Portable recording command

Start the app or supply a reviewed deployment URL then run:

```bash
node scripts/record-walkthrough.mjs --base-url http://127.0.0.1:3100 --output artifacts/walkthrough.webm
```

The helper first verifies that both provider routes are unavailable. It stops before `Assess for exceptions` if either route is enabled. It creates the parent artifact directory and records the browser workflow without provider keys. Review the generated artifact against this script before publication. The artifact must not contain a credential, personal filesystem path, delivery claim or external-execution claim.
