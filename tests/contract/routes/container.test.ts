import { describe, expect, it } from "vitest";
import {
  HttpContainerConfigurationError,
  createDefaultHttpContainer,
} from "@/server/http/container";

describe("HTTP persistence container", () => {
  it("uses both in-memory ports for local and test execution", () => {
    const container = createDefaultHttpContainer({ NODE_ENV: "test" });

    expect(container.repository.constructor.name).toBe("InMemoryRunRepository");
    expect(container.documentStore.constructor.name).toBe("InMemoryDocumentStore");
  });

  it("constructs both lazy connected ports when database and Blob are configured", () => {
    const container = createDefaultHttpContainer({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://unit-test-placeholder",
      BLOB_READ_WRITE_TOKEN: "blob-unit-test-placeholder",
    });

    expect(container.repository.constructor.name).not.toBe("InMemoryRunRepository");
    expect(container.documentStore.constructor.name).not.toBe("InMemoryDocumentStore");
  });

  it.each([
    { DATABASE_URL: "postgresql://unit-test-placeholder" },
    { BLOB_READ_WRITE_TOKEN: "blob-unit-test-placeholder" },
  ])("rejects mixed connected persistence configuration", (environment) => {
    expect(() =>
      createDefaultHttpContainer({ NODE_ENV: "test", ...environment }),
    ).toThrowError(HttpContainerConfigurationError);
  });

  it("requires connected persistence in production without a server-only override", () => {
    expect(() => createDefaultHttpContainer({ NODE_ENV: "production" })).toThrowError(
      HttpContainerConfigurationError,
    );

    expect(() =>
      createDefaultHttpContainer({
        NODE_ENV: "production",
        ALLOW_IN_MEMORY_PERSISTENCE: "true",
      }),
    ).not.toThrow();
  });

  it("prepares only the selected direct live provider without making a request", async () => {
    const container = createDefaultHttpContainer({
      NODE_ENV: "test",
      AI_LIVE_ENABLED: "true",
      OPENAI_API_KEY: "server-test-placeholder",
    });

    const provider = await container.createProvider({
      provider: "openai",
      executionMode: "live",
      sampleId: null,
    });

    expect(container.liveModeEnabled).toBe(true);
    expect(provider).toMatchObject({
      provider: "openai",
      model: "gpt-5-mini",
      executionMode: "live",
    });
  });
});
