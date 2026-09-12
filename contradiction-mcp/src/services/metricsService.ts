export interface MetricSnapshot {
  uptimeSeconds: number;
  toolInvocations: Record<string, number>;
  totalToolInvocations: number;
  totalSyncs: number;
  successfulSyncs: number;
  failedSyncs: number;
  totalScans: number;
  claimsIngested: number;
  contradictionsDetected: number;
  errorsTotal: number;
  lastError?: {
    message: string;
    timestamp: string;
  };
}

export class MetricsService {
  private readonly startTime = Date.now();
  private readonly toolCalls = new Map<string, number>();
  private totalCalls = 0;
  private totalSyncs = 0;
  private successfulSyncs = 0;
  private failedSyncs = 0;
  private totalScans = 0;
  private claimsIngested = 0;
  private contradictionsDetected = 0;
  private errorsTotal = 0;
  private lastError?: { message: string; timestamp: string };

  public recordToolCall(toolName: string): void {
    this.totalCalls++;
    const current = this.toolCalls.get(toolName) || 0;
    this.toolCalls.set(toolName, current + 1);
  }

  public recordSync(success: boolean, claimsCreated: number, contradictions: number): void {
    this.totalSyncs++;
    if (success) {
      this.successfulSyncs++;
    } else {
      this.failedSyncs++;
    }
    this.claimsIngested += claimsCreated;
    this.contradictionsDetected += contradictions;
  }

  public recordScan(contradictionsFound: number): void {
    this.totalScans++;
    this.contradictionsDetected += contradictionsFound;
  }

  public recordError(message: string): void {
    this.errorsTotal++;
    this.lastError = {
      message,
      timestamp: new Date().toISOString(),
    };
  }

  public getSnapshot(): MetricSnapshot {
    return {
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      toolInvocations: Object.fromEntries(this.toolCalls.entries()),
      totalToolInvocations: this.totalCalls,
      totalSyncs: this.totalSyncs,
      successfulSyncs: this.successfulSyncs,
      failedSyncs: this.failedSyncs,
      totalScans: this.totalScans,
      claimsIngested: this.claimsIngested,
      contradictionsDetected: this.contradictionsDetected,
      errorsTotal: this.errorsTotal,
      lastError: this.lastError,
    };
  }
}

export const globalMetrics = new MetricsService();
