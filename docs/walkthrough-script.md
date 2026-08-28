# Two-minute walkthrough

Use the real Workbench and Operations routes. Recorded mode must remain visible throughout this walkthrough.

The repository includes [the 2:03 recorded walkthrough](../artifacts/walkthrough.webm) at 1440×900. It was captured from the stable public keyless deployment on 2026-08-28. On-screen chapter captions make the artifact usable without narration and disclose that no provider request occurred.

## 0:00–0:25 — Clean recorded run

Open Workbench. Point out the keyless notice and Clean invoice fixture. Run the assurance check. Follow the streaming stages then show the Clear outcome with field evidence.

## 0:25–0:50 — Mismatch recorded run

Choose Invoice-total mismatch. Run it with the current provider selection. Show the conflicting invoice total and the Needs review outcome. Explain that the deterministic evaluator prevents a false Clear.

## 0:50–1:10 — Other provider and comparison

Select Anthropic Claude Haiku 4.5 then rerun the mismatch fixture. Select the clean run as Run A and the new mismatch run as Run B. Show values, evidence, provider, execution mode, evaluator status, latency and outcome.

## 1:10–1:35 — Operations evidence

Open Operations. Show the public-safe run trace and recorded benchmark quality. Note six recorded replays across three fixtures and two provider selections. State that the false-clear count is zero for deterministic recorded contracts only.

## 1:35–1:50 — Illustrative calculator

Scroll to the resource calculator and change Documents each month. Point to the label `Illustrative scenario — not measured savings`. Do not present the result as a measured benefit.

## 1:50–2:00 — Disclosure and gate

Close by stating that recorded keyless mode made no model request. Live direct OpenAI and Anthropic integration is disabled by default. Live accuracy and retention acceptance remain pending explicit key authorization and production verification.

## Portable recording command

Start the app or supply a reviewed deployment URL then run:

```bash
npm run record:walkthrough -- --base-url http://127.0.0.1:3100 --output artifacts/walkthrough.webm
```

The helper creates the parent artifact directory and records the actual browser workflow. It performs a clean OpenAI-selection replay, a mismatch OpenAI-selection replay, an Anthropic-selection rerun, a comparison, an Operations drill-down and a calculator update. It does not contain a credential or personal filesystem path.
