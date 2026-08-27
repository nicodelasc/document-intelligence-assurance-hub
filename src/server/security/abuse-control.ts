import {
  PersistenceConfigurationError,
  type NeonDriver,
} from "@/server/repositories/run-repository";

export type PublicReadResource = "metrics" | "run_list" | "run_detail";

export type AbuseControl = {
  allowRunSubmission(input: { bucket: string; now: Date }): Promise<boolean>;
  allowDocumentRead(input: {
    bucket: string;
    runId: string;
    now: Date;
  }): Promise<boolean>;
  allowPublicRead(input: {
    bucket: string;
    resource: PublicReadResource;
    resourceId?: string;
    now: Date;
  }): Promise<boolean>;
};

export type AbuseControlLimits = {
  runSubmissionsPerBucketPerMinute: number;
  globalRunSubmissionsPerMinute: number;
  documentReadsPerBucketAndRunPerMinute: number;
  globalDocumentReadsPerMinute: number;
  metricsReadsPerBucketPerMinute: number;
  globalMetricsReadsPerMinute: number;
  runListReadsPerBucketPerMinute: number;
  globalRunListReadsPerMinute: number;
  runDetailReadsPerBucketAndRunPerMinute: number;
  globalRunDetailReadsPerMinute: number;
};

const defaultLimits: AbuseControlLimits = {
  runSubmissionsPerBucketPerMinute: 12,
  globalRunSubmissionsPerMinute: 120,
  documentReadsPerBucketAndRunPerMinute: 30,
  globalDocumentReadsPerMinute: 300,
  metricsReadsPerBucketPerMinute: 12,
  globalMetricsReadsPerMinute: 60,
  runListReadsPerBucketPerMinute: 30,
  globalRunListReadsPerMinute: 180,
  runDetailReadsPerBucketAndRunPerMinute: 60,
  globalRunDetailReadsPerMinute: 360,
};

type WindowCounts = {
  window: number;
  global: number;
  buckets: Map<string, number>;
};

function newWindow(window: number): WindowCounts {
  return { window, global: 0, buckets: new Map() };
}

function publicReadLimits(
  limits: AbuseControlLimits,
  resource: PublicReadResource,
): { perKey: number; global: number } {
  if (resource === "metrics") {
    return {
      perKey: limits.metricsReadsPerBucketPerMinute,
      global: limits.globalMetricsReadsPerMinute,
    };
  }
  if (resource === "run_list") {
    return {
      perKey: limits.runListReadsPerBucketPerMinute,
      global: limits.globalRunListReadsPerMinute,
    };
  }
  return {
    perKey: limits.runDetailReadsPerBucketAndRunPerMinute,
    global: limits.globalRunDetailReadsPerMinute,
  };
}

function publicReadKey(input: {
  bucket: string;
  resourceId?: string;
}): string {
  return input.resourceId ? `${input.bucket}:${input.resourceId}` : input.bucket;
}

export class InMemoryAbuseControl implements AbuseControl {
  private readonly limits: AbuseControlLimits;
  private runWindow = newWindow(-1);
  private documentWindow = newWindow(-1);
  private readonly publicWindows = new Map<PublicReadResource, WindowCounts>();

  constructor(limits: Partial<AbuseControlLimits> = {}) {
    this.limits = { ...defaultLimits, ...limits };
  }

  async allowRunSubmission(input: { bucket: string; now: Date }): Promise<boolean> {
    this.runWindow = this.currentWindow(this.runWindow, input.now);
    return this.consume(
      this.runWindow,
      input.bucket,
      this.limits.runSubmissionsPerBucketPerMinute,
      this.limits.globalRunSubmissionsPerMinute,
    );
  }

  async allowDocumentRead(input: {
    bucket: string;
    runId: string;
    now: Date;
  }): Promise<boolean> {
    this.documentWindow = this.currentWindow(this.documentWindow, input.now);
    return this.consume(
      this.documentWindow,
      `${input.bucket}:${input.runId}`,
      this.limits.documentReadsPerBucketAndRunPerMinute,
      this.limits.globalDocumentReadsPerMinute,
    );
  }

  async allowPublicRead(input: {
    bucket: string;
    resource: PublicReadResource;
    resourceId?: string;
    now: Date;
  }): Promise<boolean> {
    const current = this.currentWindow(
      this.publicWindows.get(input.resource) ?? newWindow(-1),
      input.now,
    );
    this.publicWindows.set(input.resource, current);
    const limits = publicReadLimits(this.limits, input.resource);
    return this.consume(
      current,
      publicReadKey(input),
      limits.perKey,
      limits.global,
    );
  }

  private currentWindow(counts: WindowCounts, now: Date): WindowCounts {
    const window = Math.floor(now.getTime() / 60_000);
    return counts.window === window ? counts : newWindow(window);
  }

  private consume(
    counts: WindowCounts,
    key: string,
    perKeyLimit: number,
    globalLimit: number,
  ): boolean {
    const perKey = counts.buckets.get(key) ?? 0;
    if (perKey >= perKeyLimit || counts.global >= globalLimit) return false;
    counts.buckets.set(key, perKey + 1);
    counts.global += 1;
    return true;
  }
}

type NeonAbuseControlOptions = {
  databaseUrl: string | undefined;
  driver?: NeonDriver;
  limits?: Partial<AbuseControlLimits>;
};

class NeonAbuseControl implements AbuseControl {
  private readonly limits: AbuseControlLimits;
  private driverPromise: Promise<NeonDriver> | null = null;

  constructor(private readonly options: NeonAbuseControlOptions) {
    this.limits = { ...defaultLimits, ...options.limits };
  }

  async allowRunSubmission(input: { bucket: string; now: Date }): Promise<boolean> {
    return this.consume(
      "run_submission",
      input.bucket,
      input.now,
      this.limits.runSubmissionsPerBucketPerMinute,
      this.limits.globalRunSubmissionsPerMinute,
    );
  }

  async allowDocumentRead(input: {
    bucket: string;
    runId: string;
    now: Date;
  }): Promise<boolean> {
    return this.consume(
      "document",
      `${input.bucket}:${input.runId}`,
      input.now,
      this.limits.documentReadsPerBucketAndRunPerMinute,
      this.limits.globalDocumentReadsPerMinute,
    );
  }

  async allowPublicRead(input: {
    bucket: string;
    resource: PublicReadResource;
    resourceId?: string;
    now: Date;
  }): Promise<boolean> {
    const limits = publicReadLimits(this.limits, input.resource);
    return this.consume(
      input.resource,
      publicReadKey(input),
      input.now,
      limits.perKey,
      limits.global,
    );
  }

  private async consume(
    resource: string,
    key: string,
    now: Date,
    perKeyLimit: number,
    globalLimit: number,
  ): Promise<boolean> {
    const driver = await this.readyDriver();
    const window = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
    const rows = await driver.query<{ allowed: unknown }>(
      "SELECT consume_public_resource_limit($1, $2, $3, $4, $5) AS allowed",
      [resource, window.toISOString(), key, perKeyLimit, globalLimit],
    );
    const allowed = rows[0]?.allowed;
    if (allowed === true || allowed === "true" || allowed === "t" || allowed === 1) {
      return true;
    }
    if (
      allowed === false ||
      allowed === "false" ||
      allowed === "f" ||
      allowed === 0
    ) {
      return false;
    }
    throw new Error("public_resource_limit_decision_failed");
  }

  private async readyDriver(): Promise<NeonDriver> {
    if (this.driverPromise) return this.driverPromise;
    if (this.options.driver) {
      this.driverPromise = Promise.resolve(this.options.driver);
      return this.driverPromise;
    }
    if (!this.options.databaseUrl) {
      throw new PersistenceConfigurationError("neon_database_not_configured");
    }
    const databaseUrl = this.options.databaseUrl;
    this.driverPromise = (async () => {
      const { neon } = await import("@neondatabase/serverless");
      const sql = neon(databaseUrl);
      return {
        async query<T extends Record<string, unknown> = Record<string, unknown>>(
          query: string,
          parameters: unknown[] = [],
        ) {
          return (await sql.query(query, parameters)) as T[];
        },
      } satisfies NeonDriver;
    })();
    return this.driverPromise;
  }
}

export function createNeonAbuseControl(
  options: NeonAbuseControlOptions,
): AbuseControl {
  return new NeonAbuseControl(options);
}
