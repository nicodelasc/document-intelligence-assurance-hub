import { expect, test } from "@playwright/test";

const emptyRuns = { runs: [], pagination: { limit: 12, offset: 0, returned: 0 } };

function sixPagePdf(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R 6 0 R 7 0 R 8 0 R] /Count 6 >>",
    ...Array.from({ length: 6 }, () => "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>"),
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(body);
}

test("failed custom receipts survive refresh then delete independently", async ({ page }) => {
  const failedToken = "failed_receipt_token";
  const restoredToken = "restored_receipt_token";
  await page.route("**/api/runs*", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(emptyRuns) });
    }
    if (request.method() === "DELETE") {
      expect(request.url()).not.toContain(failedToken);
      expect(request.url()).not.toContain(restoredToken);
      expect(request.headers()["x-delete-token"]).toBe(failedToken);
      return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ deletion: { status: "accepted" } }) });
    }
    const body = `${JSON.stringify({
      type: "failed",
      code: "provider_unavailable",
      message: "The selected provider is temporarily unavailable.",
      runId: "run_failed_public",
      deletionToken: failedToken,
      timestamp: "2026-08-27T00:00:01.000Z",
    })}\n`;
    return route.fulfill({ status: 200, contentType: "application/x-ndjson", body });
  });
  await page.goto("/workbench");
  await page.getByText("Custom upload", { exact: true }).click();
  await page.getByLabel("Document file").setInputFiles({
    name: "safe.png",
    mimeType: "image/png",
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  });
  await page.getByLabel("Review field 1").fill("Vendor");
  await page.getByLabel("Review field 2").fill("Total");
  await page.getByRole("checkbox", { name: /publicly visible/i }).check();
  await page.getByRole("button", { name: "Run assurance check" }).click();
  await expect(page.getByText(failedToken)).toBeVisible();

  await page.evaluate(({ token }) => {
    localStorage.setItem("assurance-delete:run_restored_public", JSON.stringify({
      token,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }));
  }, { token: restoredToken });
  await page.reload();
  await expect(page.getByText(failedToken)).toBeVisible();
  await expect(page.getByText(restoredToken)).toBeVisible();

  await page.getByRole("button", { name: "Delete run run_failed_public" }).click();
  await expect(page.getByRole("alertdialog")).not.toContainText(failedToken);
  await expect(page.getByRole("alertdialog")).not.toContainText("hash");
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete now" }).click();
  await expect(page.getByText(failedToken)).not.toBeVisible();
  await expect(page.getByText(restoredToken)).toBeVisible();
});

test("picker and drop validation block invalid custom documents before POST", async ({ page }) => {
  let posts = 0;
  await page.route("**/api/runs*", async (route) => {
    if (route.request().method() === "POST") posts += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(emptyRuns) });
  });
  await page.goto("/workbench");
  await page.getByText("Custom upload", { exact: true }).click();
  await page.getByLabel("Review field 1").fill("Vendor");
  await page.getByLabel("Review field 2").fill("Total");
  await page.getByRole("checkbox", { name: /publicly visible/i }).check();

  await page.getByLabel("Document file").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("plain") });
  await page.getByRole("button", { name: "Run assurance check" }).click();
  await expect(page.getByText("Upload a PDF, PNG or JPG document.")).toBeVisible();
  await expect(page.getByLabel("Document file")).toBeFocused();

  await page.locator(".drop-zone").evaluate((dropZone) => {
    const bytes = new Uint8Array(3 * 1024 * 1024 + 1);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "too-large.png", { type: "image/png" }));
    dropZone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await expect(page.getByText("The document must be 3 MB or smaller.")).toBeVisible();

  await page.getByLabel("Document file").setInputFiles({ name: "six-pages.pdf", mimeType: "application/pdf", buffer: sixPagePdf() });
  await expect(page.getByText("PDF documents must contain no more than five pages.")).toBeVisible();
  expect(posts).toBe(0);
});

test("custom streams stay isolated then public history restores after refresh", async ({ page }) => {
  const publicRuns: Array<Record<string, unknown>> = [];
  const details = new Map<string, Record<string, unknown>>();
  let postIndex = 0;
  const eventField = (key: string, label: string, extractedValue: string, normalizedValue: string) => ({
    key,
    label,
    extractedValue,
    normalizedValue,
    evidence: `Evidence for ${extractedValue}`,
    page: 1,
    evaluatorStatus: "pass",
    referenceMatch: null,
  });
  await page.route("**/api/runs*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === "/api/runs") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ runs: publicRuns, pagination: { limit: 12, offset: 0, returned: publicRuns.length } }) });
    }
    if (request.method() === "GET") {
      const id = url.pathname.split("/").at(-1)!;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ run: details.get(id) }) });
    }
    postIndex += 1;
    const id = postIndex === 1 ? "run_stream_alpha" : "run_stream_beta";
    const ownField = postIndex === 1
      ? eventField("vendor", "Vendor", "Alpha raw", "Alpha normalized")
      : eventField("total", "Total", "Beta raw", "Beta normalized");
    const outcome = postIndex === 1 ? "evidence_consistent" : "not_found";
    const summary = {
      id,
      provider: "openai",
      model: "gpt-5-mini",
      executionMode: "live",
      sourceType: "custom",
      status: "completed",
      outcome,
      createdAt: `2026-08-27T00:00:0${postIndex}.000Z`,
      expiresAt: "2099-08-28T00:00:00.000Z",
      deletedAt: null,
      retryCount: 0,
      latencyMs: 101 + postIndex,
      estimatedCostUsd: 0,
      filename: `${id}.png`,
    };
    publicRuns.unshift(summary);
    details.set(id, {
      ...summary,
      requestedFields: [{ key: ownField.key, label: ownField.label }],
      details: { result: { fields: [ownField], outcome, latencyMs: 101 + postIndex } },
    });
    const body = [
      JSON.stringify({ type: "field", field: ownField, timestamp: "2026-08-27T00:00:00.000Z" }),
      JSON.stringify({ type: "completed", outcome, runId: id, executionMode: "live", deletionToken: `token_${id}`, timestamp: "2026-08-27T00:00:01.000Z" }),
    ].join("\n") + "\n";
    return route.fulfill({ status: 200, contentType: "application/x-ndjson", body });
  });
  await page.route("**/api/runs/*", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ run: details.get(id) }),
    });
  });
  await page.goto("/workbench");
  await page.getByText("Custom upload", { exact: true }).click();
  await page.getByLabel("Document file").setInputFiles({
    name: "safe.png",
    mimeType: "image/png",
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  });
  await page.getByLabel("Review field 1").fill("Vendor");
  await page.getByLabel("Review field 2").fill("Total");
  await page.getByRole("checkbox", { name: /publicly visible/i }).check();
  await page.getByRole("button", { name: "Run assurance check" }).click();
  await expect(page.getByRole("heading", { name: "Evidence-consistent" })).toBeFocused();
  await page.getByRole("button", { name: "Run assurance check" }).click();
  await expect(page.getByRole("heading", { name: "Not found" })).toBeFocused();

  await page.reload();
  await page.getByLabel("Run A").selectOption("run_stream_alpha");
  await page.getByLabel("Run B").selectOption("run_stream_beta");
  const comparison = page.getByRole("table", { name: /comparison of two assurance runs/i });
  await expect(comparison).toContainText("Extracted: Alpha raw · Normalized: Alpha normalized");
  await expect(comparison).toContainText("Extracted: Beta raw · Normalized: Beta normalized");
  await expect(comparison).not.toContainText("Northstar Paperworks");
});

test("Operations restores URL state and exposes the complete active inspector", async ({ page }) => {
  const runs = Array.from({ length: 12 }, (_, index) => ({
    id: `ops_${index + 1}`,
    provider: index % 2 === 0 ? "openai" : "anthropic",
    model: index % 2 === 0 ? "gpt-5-mini" : "claude-haiku-4.5",
    executionMode: "recorded",
    sourceType: "synthetic",
    status: "completed",
    outcome: index === 0 ? "conflict" : index === 1 ? "not_found" : "evidence_consistent",
    createdAt: "2026-08-27T00:00:00.000Z",
    expiresAt: "2099-08-28T00:00:00.000Z",
    deletedAt: null,
    retryCount: 0,
    latencyMs: 100,
    estimatedCostUsd: 0,
    filename: `fixture-${index + 1}.pdf`,
  }));
  const metrics = {
    generatedAt: "2026-08-27T00:00:00.000Z",
    summary: { totalRuns: 1, completionRate: 1, reviewRate: 1, failureRate: 0 },
    performance: { sampleCount: 1, p50LatencyMs: 100, p95LatencyMs: 100, retryCount: 0, averageStepDurationsMs: { validating: 20 } },
    usage: { inputTokens: 0, outputTokens: 0, providerSplit: { openai: 1, anthropic: 0 }, recordedRuns: 1, liveRuns: 0, estimatedApiCostUsd: 0, pricingAsOf: "2026-08-27" },
    benchmark: { source: "recorded_fixture_replay", liveRuns: 0, recordedRuns: 6, providerCoverage: { openai: 3, anthropic: 3 }, exactMatchRate: 1, missingFieldRecall: 1, evaluatorAgreement: 1, falseClearCount: 0 },
    retention: { activePublicUploads: 0, upcomingExpirations: 0, cleanupBacklog: 0, sampleCount: 1 },
    runExplorer: runs,
    resourceScenario: { modelCostAssumption: { averageModelCostPerRunUsd: 0, usdToSgd: 1.35 } },
  };
  await page.route("**/api/metrics", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(metrics) }));
  await page.route("**/api/runs/ops_1", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ run: {
    ...runs[0],
    promptVersion: "document-extraction-2026-08-27.v1",
    file: { filename: "fixture-1.pdf", mediaType: "application/pdf", sizeBytes: 1024, pageCount: 1 },
    requestedFields: [{ key: "vendor_name", label: "Vendor name" }],
    usage: { inputTokens: 0, outputTokens: 0 },
    stepDurations: { validating: 20 },
    documentUrl: "/api/runs/ops_1/document",
    details: { steps: [{ kind: "stage", stage: "validating", timestamp: "2026-08-27T00:00:00.000Z", durationMs: 20 }], result: { fields: [{ key: "vendor_name", label: "Vendor name", extractedValue: "Northstar", normalizedValue: "northstar", evidence: "Supplier Northstar", page: 1, evaluatorStatus: "pass", referenceMatch: true }], outcome: "conflict", usage: { inputTokens: 0, outputTokens: 0 }, estimatedCostUsd: 0, retryCount: 0, latencyMs: 100, stepDurations: { validating: 20 }, completedAt: "2026-08-27T00:00:01.000Z" } },
  } }) }));
  await page.route("**/api/runs/ops_1/document", async (route) => route.fulfill({ status: 200, contentType: "application/pdf", body: "%PDF-1.4\n%%EOF" }));
  await page.goto("/operations");
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
  await expect(page.getByText("Anthropic 0 public runs")).toBeVisible();
  await expect(page.getByText("Benchmark coverage: OpenAI 3 · Anthropic 3")).toBeVisible();
  await page.getByLabel("Outcome filter").selectOption("conflict");
  await page.getByLabel("Provider filter").selectOption("openai");
  await page.goBack();
  await expect(page.getByLabel("Provider filter")).toHaveValue("all");
  await expect(page.getByLabel("Outcome filter")).toHaveValue("conflict");
  await page.goForward();
  await expect(page.getByLabel("Provider filter")).toHaveValue("openai");
  await page.getByRole("radio", { name: "Select ops_1" }).check();
  await expect(page.getByTitle("Active document preview for fixture-1.pdf")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reference comparison" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Telemetry and steps" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Safe errors" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Run detail views" })).toHaveCount(0);
});

test("navigating away aborts an active Workbench stream", async ({ page }) => {
  let requestFailed = false;
  page.on("requestfailed", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/runs")) requestFailed = true;
  });
  await page.route("**/api/runs*", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(emptyRuns) });
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    return route.fulfill({ status: 200, contentType: "application/x-ndjson", body: `${JSON.stringify({ type: "completed", outcome: "clear", runId: "late_run", executionMode: "recorded", deletionToken: "late_token", timestamp: "2026-08-27T00:00:01.000Z" })}\n` });
  });
  await page.route("**/api/metrics", async (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
  await page.goto("/workbench");
  await page.getByRole("button", { name: "Run assurance check" }).click();
  await page.getByRole("link", { name: "Operations" }).click();
  await expect(page).toHaveURL(/\/operations/);
  await expect.poll(() => requestFailed).toBe(true);
});
