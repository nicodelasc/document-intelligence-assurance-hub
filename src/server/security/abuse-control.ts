export type AbuseControl = {
  allowRunSubmission(input: { bucket: string; now: Date }): Promise<boolean>;
  allowDocumentRead(input: {
    bucket: string;
    runId: string;
    now: Date;
  }): Promise<boolean>;
};

type AbuseControlLimits = {
  runSubmissionsPerBucketPerMinute: number;
  globalRunSubmissionsPerMinute: number;
  documentReadsPerBucketAndRunPerMinute: number;
  globalDocumentReadsPerMinute: number;
};

const defaultLimits: AbuseControlLimits = {
  runSubmissionsPerBucketPerMinute: 12,
  globalRunSubmissionsPerMinute: 120,
  documentReadsPerBucketAndRunPerMinute: 30,
  globalDocumentReadsPerMinute: 300,
};

type WindowCounts = {
  window: number;
  global: number;
  buckets: Map<string, number>;
};

function newWindow(window: number): WindowCounts {
  return { window, global: 0, buckets: new Map() };
}

export class InMemoryAbuseControl implements AbuseControl {
  private readonly limits: AbuseControlLimits;
  private runWindow = newWindow(-1);
  private documentWindow = newWindow(-1);

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
