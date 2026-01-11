import { randomUUID } from 'crypto';

// ==================== Types ====================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'critical';

export interface LogTideClientOptions {
  apiUrl: string;
  apiKey: string;
  batchSize?: number;
  flushInterval?: number;
  maxBufferSize?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  circuitBreakerThreshold?: number;
  circuitBreakerResetMs?: number;
  enableMetrics?: boolean;
  debug?: boolean;
  globalMetadata?: Record<string, unknown>;
  autoTraceId?: boolean;
}

export interface LogEntry {
  service: string;
  level: LogLevel;
  message: string;
  time?: string;
  metadata?: Record<string, unknown>;
  trace_id?: string;
}

export interface InternalLogEntry extends LogEntry {
  time: string;
}

export interface QueryOptions {
  service?: string;
  level?: LogLevel;
  from?: Date | string;
  to?: Date | string;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface LogsResponse {
  logs: InternalLogEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface AggregatedStatsOptions {
  from: Date | string;
  to: Date | string;
  interval?: '1m' | '5m' | '1h' | '1d';
  service?: string;
}

export interface AggregatedStatsResponse {
  timeseries: Array<{
    bucket: string;
    total: number;
    by_level: Record<string, number>;
  }>;
  top_services: Array<{ service: string; count: number }>;
  top_errors: Array<{ message: string; count: number }>;
}

export interface ClientMetrics {
  logsSent: number;
  logsDropped: number;
  errors: number;
  retries: number;
  avgLatencyMs: number;
  circuitBreakerTrips: number;
}

export interface StreamOptions {
  service?: string;
  level?: LogLevel;
  onLog: (log: InternalLogEntry) => void;
  onError?: (error: Error) => void;
}

// ==================== Circuit Breaker ====================

enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private lastFailureTime: number | null = null;

  constructor(
    private threshold: number,
    private resetMs: number,
  ) {}

  recordSuccess() {
    this.failureCount = 0;
    this.state = CircuitState.CLOSED;
  }

  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.threshold) {
      this.state = CircuitState.OPEN;
    }
  }

  canAttempt(): boolean {
    if (this.state === CircuitState.CLOSED) {
      return true;
    }

    if (this.state === CircuitState.OPEN) {
      const now = Date.now();
      if (this.lastFailureTime && now - this.lastFailureTime >= this.resetMs) {
        this.state = CircuitState.HALF_OPEN;
        return true;
      }
      return false;
    }

    // HALF_OPEN state - allow one attempt
    return true;
  }

  getState(): CircuitState {
    return this.state;
  }
}

// ==================== UUID Validation ====================

/**
 * Validates if a string is a valid UUID (v4)
 */
function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Normalizes a trace_id to ensure it's a valid UUID.
 * If invalid, generates a new UUID and warns in debug mode.
 */
function normalizeTraceId(traceId: string | null | undefined, debug: boolean): string | undefined {
  if (!traceId) {
    return undefined;
  }

  if (isValidUUID(traceId)) {
    return traceId;
  }

  // Invalid UUID - generate a new one
  const newTraceId = randomUUID();
  if (debug) {
    console.warn(
      `[LogTide] Invalid trace_id "${traceId}" (must be UUID v4). Generated new UUID: ${newTraceId}`,
    );
  }
  return newTraceId;
}

// ==================== Error Serialization ====================

export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const result: Record<string, unknown> = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };

    if (error.cause) {
      result.cause = serializeError(error.cause);
    }

    return result;
  }

  if (typeof error === 'string') {
    return { message: error };
  }

  if (typeof error === 'object' && error !== null) {
    return error as Record<string, unknown>;
  }

  return { message: String(error) };
}

// ==================== Main Client ====================

export class LogTideClient {
  private apiUrl: string;
  private apiKey: string;
  private batchSize: number;
  private flushInterval: number;
  private maxBufferSize: number;
  private maxRetries: number;
  private retryDelayMs: number;
  private enableMetrics: boolean;
  private debugMode: boolean;
  private globalMetadata: Record<string, unknown>;
  private autoTraceId: boolean;

  private buffer: InternalLogEntry[] = [];
  private timer: NodeJS.Timeout | null = null;
  private circuitBreaker: CircuitBreaker;

  // Metrics
  private metrics: ClientMetrics = {
    logsSent: 0,
    logsDropped: 0,
    errors: 0,
    retries: 0,
    avgLatencyMs: 0,
    circuitBreakerTrips: 0,
  };
  private latencies: number[] = [];

  // Context tracking
  private currentTraceId: string | null = null;

  constructor(options: LogTideClientOptions) {
    this.apiUrl = options.apiUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.batchSize = options.batchSize || 100;
    this.flushInterval = options.flushInterval || 5000;
    this.maxBufferSize = options.maxBufferSize || 10000;
    this.maxRetries = options.maxRetries || 3;
    this.retryDelayMs = options.retryDelayMs || 1000;
    this.enableMetrics = options.enableMetrics ?? true;
    this.debugMode = options.debug ?? false;
    this.globalMetadata = options.globalMetadata || {};
    this.autoTraceId = options.autoTraceId ?? false;

    this.circuitBreaker = new CircuitBreaker(
      options.circuitBreakerThreshold || 5,
      options.circuitBreakerResetMs || 30000,
    );

    this.startFlushTimer();
  }

  // ==================== Context Helpers ====================

  /**
   * Set trace ID for subsequent logs
   * Automatically validates and normalizes to UUID v4
   */
  setTraceId(traceId: string | null) {
    this.currentTraceId = normalizeTraceId(traceId, this.debugMode) || null;
  }

  /**
   * Get current trace ID
   */
  getTraceId(): string | null {
    return this.currentTraceId;
  }

  /**
   * Execute function with a specific trace ID context
   */
  withTraceId<T>(traceId: string, fn: () => T): T {
    const previousTraceId = this.currentTraceId;
    this.currentTraceId = traceId;
    try {
      return fn();
    } finally {
      this.currentTraceId = previousTraceId;
    }
  }

  /**
   * Execute function with a new auto-generated trace ID
   */
  withNewTraceId<T>(fn: () => T): T {
    return this.withTraceId(randomUUID(), fn);
  }

  // ==================== Logging Methods ====================

  private startFlushTimer() {
    this.timer = setInterval(() => {
      this.flush();
    }, this.flushInterval);
  }

  log(entry: LogEntry) {
    // Check buffer size limit
    if (this.buffer.length >= this.maxBufferSize) {
      this.metrics.logsDropped++;
      if (this.debugMode) {
        console.warn(`[LogTide] Buffer full, dropping log: ${entry.message}`);
      }
      return;
    }

    // Normalize trace_id to ensure it's a valid UUID
    const normalizedTraceId =
      normalizeTraceId(entry.trace_id, this.debugMode) ||
      normalizeTraceId(this.currentTraceId, this.debugMode) ||
      (this.autoTraceId ? randomUUID() : undefined);

    const internalEntry: InternalLogEntry = {
      ...entry,
      time: entry.time || new Date().toISOString(),
      metadata: {
        ...this.globalMetadata,
        ...entry.metadata,
      },
      trace_id: normalizedTraceId,
    };

    this.buffer.push(internalEntry);

    if (this.buffer.length >= this.batchSize) {
      this.flush();
    }
  }

  debug(service: string, message: string, metadata?: Record<string, unknown>) {
    this.log({ service, level: 'debug', message, metadata });
  }

  info(service: string, message: string, metadata?: Record<string, unknown>) {
    this.log({ service, level: 'info', message, metadata });
  }

  warn(service: string, message: string, metadata?: Record<string, unknown>) {
    this.log({ service, level: 'warn', message, metadata });
  }

  error(service: string, message: string, metadataOrError?: Record<string, unknown> | Error) {
    let metadata: Record<string, unknown> = {};

    if (metadataOrError instanceof Error) {
      metadata = { error: serializeError(metadataOrError) };
    } else if (metadataOrError) {
      metadata = metadataOrError;
    }

    this.log({ service, level: 'error', message, metadata });
  }

  critical(service: string, message: string, metadataOrError?: Record<string, unknown> | Error) {
    let metadata: Record<string, unknown> = {};

    if (metadataOrError instanceof Error) {
      metadata = { error: serializeError(metadataOrError) };
    } else if (metadataOrError) {
      metadata = metadataOrError;
    }

    this.log({ service, level: 'critical', message, metadata });
  }

  // ==================== Flush with Retry & Circuit Breaker ====================

  async flush() {
    if (this.buffer.length === 0) return;

    // Check circuit breaker
    if (!this.circuitBreaker.canAttempt()) {
      this.metrics.circuitBreakerTrips++;
      if (this.debugMode) {
        console.warn('[LogTide] Circuit breaker OPEN, skipping flush');
      }
      return;
    }

    const logs = [...this.buffer];
    this.buffer = [];

    const startTime = Date.now();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch(`${this.apiUrl}/api/v1/ingest`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': this.apiKey,
          },
          body: JSON.stringify({ logs }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        // Success
        this.circuitBreaker.recordSuccess();
        this.metrics.logsSent += logs.length;

        if (this.enableMetrics) {
          const latency = Date.now() - startTime;
          this.latencies.push(latency);
          if (this.latencies.length > 100) {
            this.latencies.shift();
          }
          this.metrics.avgLatencyMs =
            this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length;
        }

        if (this.debugMode) {
          console.log(`[LogTide] Sent ${logs.length} logs successfully`);
        }

        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.metrics.errors++;

        if (attempt < this.maxRetries) {
          this.metrics.retries++;
          const delay = this.retryDelayMs * Math.pow(2, attempt);
          if (this.debugMode) {
            console.warn(
              `[LogTide] Retry ${attempt + 1}/${this.maxRetries} after ${delay}ms: ${lastError.message}`,
            );
          }
          await this.sleep(delay);
        }
      }
    }

    // All retries failed
    this.circuitBreaker.recordFailure();

    if (this.debugMode) {
      console.error(`[LogTide] Failed to send logs after ${this.maxRetries} retries:`, lastError);
    }

    // Re-add logs to buffer if not full
    if (this.buffer.length + logs.length <= this.maxBufferSize) {
      this.buffer.unshift(...logs);
    } else {
      this.metrics.logsDropped += logs.length;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ==================== Query Methods ====================

  async query(options: QueryOptions = {}): Promise<LogsResponse> {
    const params = new URLSearchParams();

    if (options.service) params.append('service', options.service);
    if (options.level) params.append('level', options.level);
    if (options.from) {
      const from = options.from instanceof Date ? options.from.toISOString() : options.from;
      params.append('from', from);
    }
    if (options.to) {
      const to = options.to instanceof Date ? options.to.toISOString() : options.to;
      params.append('to', to);
    }
    if (options.q) params.append('q', options.q);
    if (options.limit) params.append('limit', String(options.limit));
    if (options.offset) params.append('offset', String(options.offset));

    const url = `${this.apiUrl}/api/v1/logs?${params.toString()}`;

    const response = await fetch(url, {
      headers: {
        'X-API-Key': this.apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Query failed: HTTP ${response.status}: ${errorText}`);
    }

    return (await response.json()) as LogsResponse;
  }

  async getByTraceId(traceId: string): Promise<InternalLogEntry[]> {
    const url = `${this.apiUrl}/api/v1/logs/trace/${traceId}`;

    const response = await fetch(url, {
      headers: {
        'X-API-Key': this.apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Get by trace ID failed: HTTP ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as { logs?: InternalLogEntry[] };
    return data.logs || [];
  }

  async getAggregatedStats(options: AggregatedStatsOptions): Promise<AggregatedStatsResponse> {
    const params = new URLSearchParams();

    const from = options.from instanceof Date ? options.from.toISOString() : options.from;
    const to = options.to instanceof Date ? options.to.toISOString() : options.to;

    params.append('from', from);
    params.append('to', to);
    if (options.interval) params.append('interval', options.interval);
    if (options.service) params.append('service', options.service);

    const url = `${this.apiUrl}/api/v1/logs/aggregated?${params.toString()}`;

    const response = await fetch(url, {
      headers: {
        'X-API-Key': this.apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Get aggregated stats failed: HTTP ${response.status}: ${errorText}`);
    }

    return (await response.json()) as AggregatedStatsResponse;
  }

  // ==================== Live Tail (SSE) ====================

  stream(options: StreamOptions): () => void {
    const params = new URLSearchParams();
    params.append('token', this.apiKey);
    if (options.service) params.append('service', options.service);
    if (options.level) params.append('level', options.level);

    const url = `${this.apiUrl}/api/v1/logs/stream?${params.toString()}`;

    const eventSource = new EventSource(url);

    eventSource.addEventListener('log', (event: Event) => {
      try {
        const messageEvent = event as MessageEvent;
        const log = JSON.parse(messageEvent.data) as InternalLogEntry;
        options.onLog(log);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        options.onError?.(err);
      }
    });

    eventSource.addEventListener('error', () => {
      const error = new Error('SSE connection error');
      options.onError?.(error);
    });

    // Return cleanup function
    return () => {
      eventSource.close();
    };
  }

  // ==================== Metrics ====================

  getMetrics(): ClientMetrics {
    return { ...this.metrics };
  }

  resetMetrics() {
    this.metrics = {
      logsSent: 0,
      logsDropped: 0,
      errors: 0,
      retries: 0,
      avgLatencyMs: 0,
      circuitBreakerTrips: 0,
    };
    this.latencies = [];
  }

  getCircuitBreakerState(): string {
    return this.circuitBreaker.getState();
  }

  // ==================== Cleanup ====================

  async close() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }
}

export default LogTideClient;
