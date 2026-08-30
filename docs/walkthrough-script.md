# Two-minute walkthrough

Use the real Workbench and Operations routes with provider keys absent. The fallback boundary must remain visible throughout this walkthrough.

The repository includes [the current recorded walkthrough](../artifacts/walkthrough.webm) at 1440×900. Its measured duration is 2:07.64. It was regenerated from the two-family interface with `AI_LIVE_ENABLED=false`. On-screen chapter captions make the artifact usable without narration and state the non-execution boundaries. Provider acceptance is not established by this artifact.

## 0:00–0:15 — Two document families and the keyless boundary

Open Workbench. Show `Supplier invoices` and `Warehouse goods receipts` with five fixtures in each family. Explain that these fixtures form 10 provider-neutral observations. Show the native `Processing model` selector then point out `Sample results - no AI processing`. Browsing fixtures and changing the model selection do not start processing.

## 0:15–0:30 — One correct fixture and three visible stages

Under Supplier invoices choose `Clean match` then press `Process document`. Follow `Understand document`, `Verify evidence` and `Resolve and prepare action`. Show the Clear outcome and `No AI processing` attribution. The selected model is configuration while persisted confirmed dispatch is the only provider-call evidence.

## 0:30–1:01 — Discrepancy and prepared simulated workflow action

Choose `Total mismatch`, select Claude Haiku 4.5 through `Processing model` then press `Process document`. Show the conflicting invoice total and Needs review outcome. Open `Prepare email to the selected role`, leave Recipient role blank long enough to show the disabled control then select Buyer and choose `Prepare copy`. Show `Prepared only - not sent` and the Workflow activity entry. The prepared copy is response-only and no external connector receives it.

## 1:01–1:13 — Run comparison

Use `Run A` and `Run B` to compare the correct and discrepancy runs. Show requested fields, evidence, outcome, selected configuration and truthful provider attribution side by side.

## 1:13–1:36 — Operations workspace

Open `Operations workspace`. Show workflow status, Latest simulated workflow activity and the `Reference quality suite`. State that it contains 10 provider-neutral observations with five Supplier invoices and five Warehouse goods receipts. Open a run detail and show `No AI processing` rather than inferring a provider call from the selected model.

## 1:36–1:58 — Costs workspace

Open `Costs workspace`. Show `US$0.00` settled and completed estimates plus `No confirmed model runs`. Open `Illustrative resource scenario`, show the SGD inputs and change Documents each month. Every result remains illustrative rather than measured impact.

## 1:58–2:08 — Disclosure and gate

Close by stating that this walkthrough made no model request, delivered no email and executed no external action. No external connector is present in the demonstrated workflow. Provider acceptance is not established and requires a separately authorized credential session.

## Portable recording command

Start the app or supply a reviewed deployment URL then run:

```bash
node scripts/record-walkthrough.mjs --base-url http://127.0.0.1:3100 --output artifacts/walkthrough.webm
```

The helper first verifies that both provider routes are unavailable. It stops before `Process document` if either route is enabled. It creates the parent artifact directory and records the browser workflow without provider keys. Review the generated artifact against this script before publication. The artifact must not contain a credential, personal filesystem path, delivery claim or external-execution claim.
