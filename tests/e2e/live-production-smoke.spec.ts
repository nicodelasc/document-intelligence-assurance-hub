import { join } from "node:path";
import {
  expect,
  test,
  type APIRequestContext,
  type Request as PlaywrightRequest,
  type Response,
} from "@playwright/test";
import { idempotentRunId } from "../../src/server/http/run-id";
import {
  PAID_SMOKE_DESCRIBE_OPTIONS,
  createPaidSmokeRequestGuard,
  readProviderAttemptLimitHeader,
} from "./support/paid-smoke-guard";

const paidSmokeBaseUrl =
  process.env.PAID_SMOKE_BASE_URL ??
  "https://document-intelligence-assurance-hub.vercel.app";
const terminalOutcomes = [
  "clear",
  "needs_review",
  "incomplete",
  "evidence_consistent",
  "conflict",
  "not_found",
];

test.skip(
  process.env.RUN_PAID_SMOKE !== "1",
  "paid smoke requires explicit opt-in",
);
test.describe.configure(PAID_SMOKE_DESCRIBE_OPTIONS);

type PublicRun = {
  id: string;
  status: string;
  outcome: string | null;
  executionMode: string;
  providerCalled: boolean;
  provider: string | null;
  model: string | null;
  sourceOriginStatus: string;
  retryCount: number;
  usage: { inputTokens: number; outputTokens: number };
  estimatedCostUsd: number;
  consent: boolean;
  requestedFields: Array<{ key: string; label: string }>;
};

async function readPublicRun(
  request: APIRequestContext,
  runId: string,
): Promise<PublicRun> {
  const response = await request.get(`/api/runs/${encodeURIComponent(runId)}`);
  expect(response.status()).toBe(200);
  const payload = (await response.json()) as { run?: PublicRun };
  expect(payload.run).toBeDefined();
  return payload.run!;
}

async function submittedRunId(
  request: Pick<PlaywrightRequest, "headerValue">,
): Promise<string> {
  const idempotencyKey = (await request.headerValue("idempotency-key"))?.trim();
  expect(idempotencyKey).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
  return idempotentRunId(idempotencyKey!);
}

async function expectGuardedCompletedRun(input: {
  response: Response;
  request: APIRequestContext;
  provider: "openai" | "anthropic";
  model: string;
  sourceOriginStatus: "server_original" | "unverified";
}) {
  expect(input.response.status()).toBe(200);
  expect(await readProviderAttemptLimitHeader(input.response.request())).toBe(
    "1",
  );
  expect(await input.response.finished()).toBeNull();
  const runId = await submittedRunId(input.response.request());

  const run = await readPublicRun(input.request, runId);
  expect(run).toMatchObject({
    id: runId,
    status: "completed",
    executionMode: "live",
    providerCalled: true,
    provider: input.provider,
    model: input.model,
    sourceOriginStatus: input.sourceOriginStatus,
    retryCount: 0,
  });
  expect(terminalOutcomes).toContain(run.outcome);
  expect(run.usage.inputTokens).toBeGreaterThanOrEqual(0);
  expect(run.usage.outputTokens).toBeGreaterThanOrEqual(0);
  expect(run.estimatedCostUsd).toBeGreaterThanOrEqual(0);
  return run;
}

test("accepts one guarded OpenAI built-in clean-fixture run", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ baseURL: paidSmokeBaseUrl });
  const page = await context.newPage();
  const guard = createPaidSmokeRequestGuard();
  await page.route("**/api/runs", (route) => guard.handle(route));

  try {
    await page.goto("/workbench");
    await expect(
      page.getByRole("button", { name: /Clean match/i }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByLabel("Processing model").selectOption("gpt-5.6-luna");
    await expect(
      page.getByRole("note").filter({ hasText: "Live AI processing" }),
    ).toBeVisible();

    const runResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/api/runs"),
    );
    await page
      .getByRole("button", { name: "Run live document review" })
      .click();
    const run = await expectGuardedCompletedRun({
      response: await runResponsePromise,
      request: context.request,
      provider: "openai",
      model: "gpt-5.6-luna",
      sourceOriginStatus: "server_original",
    });
    await expect(
      page.getByText("Review complete", { exact: true }),
    ).toBeVisible();

    expect(run.consent).toBe(false);
    await expect(
      page.getByText("Original demo document", { exact: true }),
    ).toBeVisible();
    expect(guard.submittedRuns()).toBe(1);
  } finally {
    await context.close();
  }
});

test("accepts one guarded Anthropic unverified custom-upload run", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ baseURL: paidSmokeBaseUrl });
  const page = await context.newPage();
  const guard = createPaidSmokeRequestGuard();
  await page.route("**/api/runs", (route) => guard.handle(route));

  try {
    await page.goto("/workbench");
    const chooserPromise = page.waitForEvent("filechooser");
    await page
      .getByRole("button", { name: "+ Add your document" })
      .press("Enter");
    const chooser = await chooserPromise;
    await chooser.setFiles(
      join(process.cwd(), "public", "samples", "invoice-clean-match.png"),
    );
    await page.getByLabel("Review field 1").fill("Supplier name");
    await page.getByLabel("Review field 2").fill("Invoice total");
    await page
      .getByLabel(/raw file and result will be publicly visible/i)
      .check();
    await page.getByLabel("Processing model").selectOption("claude-haiku-4-5");
    await expect(
      page.getByRole("note").filter({ hasText: "Live AI processing" }),
    ).toBeVisible();

    const runResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/api/runs"),
    );
    await page
      .getByRole("button", { name: "Run live document review" })
      .click();
    const run = await expectGuardedCompletedRun({
      response: await runResponsePromise,
      request: context.request,
      provider: "anthropic",
      model: "claude-haiku-4-5",
      sourceOriginStatus: "unverified",
    });
    await expect(
      page.getByText("Review complete", { exact: true }),
    ).toBeVisible();

    expect(run.consent).toBe(true);
    expect(run.requestedFields.map((field) => field.label)).toEqual([
      "Supplier name",
      "Invoice total",
    ]);
    await expect(
      page.getByText("Source unverified", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Prepare posting handoff" }),
    ).toHaveCount(0);
    expect(guard.submittedRuns()).toBe(1);
  } finally {
    await context.close();
  }
});
