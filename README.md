# LogTide Node.js SDK

Official Node.js SDK for LogTide with advanced features: retry logic, circuit breaker, query API, live streaming, and middleware support.

## Features

- ✅ **Automatic batching** with configurable size and interval
- ✅ **Retry logic** with exponential backoff
- ✅ **Circuit breaker** pattern for fault tolerance
- ✅ **Max buffer size** with drop policy to prevent memory leaks
- ✅ **Query API** for searching and filtering logs
- ✅ **Live tail** with Server-Sent Events (SSE)
- ✅ **Trace ID context** for distributed tracing
- ✅ **Global metadata** added to all logs
- ✅ **Structured error serialization**
- ✅ **Internal metrics** (logs sent, errors, latency, etc.)
- ✅ **Express & Fastify middleware** for auto-logging HTTP requests
- ✅ **Full TypeScript support** with strict types

## Installation

```bash
npm install @logtide/sdk-node
# or
pnpm add @logtide/sdk-node
# or
yarn add @logtide/sdk-node
```

## Quick Start

```typescript
import { LogTideClient } from '@logtide/sdk-node';

const client = new LogTideClient({
  apiUrl: 'http://localhost:8080',
  apiKey: 'lp_your_api_key_here',
});

// Send logs
client.info('api-gateway', 'Server started', { port: 3000 });
client.error('database', 'Connection failed', new Error('Timeout'));

// Graceful shutdown
process.on('SIGINT', async () => {
  await client.close();
  process.exit(0);
});
```

---

## Configuration Options

### Basic Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiUrl` | `string` | **required** | Base URL of your LogTide instance |
| `apiKey` | `string` | **required** | Project API key (starts with `lp_`) |
| `batchSize` | `number` | `100` | Number of logs to batch before sending |
| `flushInterval` | `number` | `5000` | Interval in ms to auto-flush logs |

### Advanced Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxBufferSize` | `number` | `10000` | Max logs in buffer (prevents memory leak) |
| `maxRetries` | `number` | `3` | Max retry attempts on failure |
| `retryDelayMs` | `number` | `1000` | Initial retry delay (exponential backoff) |
| `circuitBreakerThreshold` | `number` | `5` | Failures before opening circuit |
| `circuitBreakerResetMs` | `number` | `30000` | Time before retrying after circuit opens |
| `enableMetrics` | `boolean` | `true` | Track internal metrics |
| `debug` | `boolean` | `false` | Enable debug logging to console |
| `globalMetadata` | `object` | `{}` | Metadata added to all logs |
| `autoTraceId` | `boolean` | `false` | Auto-generate trace IDs for logs |

### Example: Full Configuration

```typescript
const client = new LogTideClient({
  apiUrl: 'http://localhost:8080',
  apiKey: 'lp_your_api_key_here',

  // Batching
  batchSize: 100,
  flushInterval: 5000,

  // Buffer management
  maxBufferSize: 10000,

  // Retry with exponential backoff (1s → 2s → 4s)
  maxRetries: 3,
  retryDelayMs: 1000,

  // Circuit breaker
  circuitBreakerThreshold: 5,
  circuitBreakerResetMs: 30000,

  // Metrics & debugging
  enableMetrics: true,
  debug: true,

  // Global context
  globalMetadata: {
    env: process.env.NODE_ENV,
    version: '1.0.0',
    hostname: process.env.HOSTNAME,
  },

  // Auto trace IDs
  autoTraceId: false,
});
```

---

## Logging Methods

### Basic Logging

```typescript
client.debug('service-name', 'Debug message');
client.info('service-name', 'Info message', { userId: 123 });
client.warn('service-name', 'Warning message');
client.error('service-name', 'Error message', { custom: 'data' });
client.critical('service-name', 'Critical message');
```

### Error Logging with Auto-Serialization

The SDK automatically serializes `Error` objects:

```typescript
try {
  throw new Error('Database timeout');
} catch (error) {
  // Automatically serializes error with stack trace
  client.error('database', 'Query failed', error);
}
```

Generated log metadata:
```json
{
  "error": {
    "name": "Error",
    "message": "Database timeout",
    "stack": "Error: Database timeout\n    at ..."
  }
}
```

### Custom Log Entry

```typescript
client.log({
  service: 'custom-service',
  level: 'info',
  message: 'Custom log',
  time: new Date().toISOString(), // Optional
  metadata: { key: 'value' },
  trace_id: 'custom-trace-id', // Optional
});
```

---

## Trace ID Context

Track requests across services with trace IDs.

### Manual Trace ID

```typescript
client.setTraceId('request-123');

client.info('api', 'Request received');
client.info('database', 'Querying users');
client.info('api', 'Response sent');

client.setTraceId(null); // Clear context
```

### Scoped Trace ID

```typescript
client.withTraceId('request-456', () => {
  client.info('api', 'Processing in context');
  client.warn('cache', 'Cache miss');
});
// Trace ID automatically restored after block
```

### Auto-Generated Trace ID

```typescript
client.withNewTraceId(() => {
  client.info('worker', 'Background job started');
  client.info('worker', 'Job completed');
});
```

### Auto Trace ID Mode

```typescript
const client = new LogTideClient({
  apiUrl: 'http://localhost:8080',
  apiKey: 'lp_your_api_key_here',
  autoTraceId: true, // Every log gets a unique trace ID
});
```

---

## Query API

Search and retrieve logs programmatically.

### Basic Query

```typescript
const result = await client.query({
  service: 'api-gateway',
  level: 'error',
  from: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24h
  to: new Date(),
  limit: 100,
  offset: 0,
});

console.log(`Found ${result.total} logs`);
console.log(result.logs);
```

### Full-Text Search

```typescript
const result = await client.query({
  q: 'timeout',
  limit: 50,
});
```

### Get Logs by Trace ID

```typescript
const logs = await client.getByTraceId('trace-123');
console.log(`Trace has ${logs.length} logs`);
```

### Aggregated Statistics

```typescript
const stats = await client.getAggregatedStats({
  from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
  to: new Date(),
  interval: '1h', // '1m' | '5m' | '1h' | '1d'
  service: 'api-gateway', // Optional
});

console.log(stats.timeseries); // Time-bucketed counts
console.log(stats.top_services); // Top services by log count
console.log(stats.top_errors); // Most common errors
```

---

## Live Tail (Streaming)

Stream logs in real-time using Server-Sent Events.

```typescript
const cleanup = client.stream({
  service: 'api-gateway', // Optional filter
  level: 'error', // Optional filter

  onLog: (log) => {
    console.log(`[${log.time}] ${log.level}: ${log.message}`);
  },

  onError: (error) => {
    console.error('Stream error:', error);
  },
});

// Stop streaming when done
setTimeout(() => {
  cleanup();
}, 60000);
```

---

## Metrics

Track SDK performance and health.

```typescript
const metrics = client.getMetrics();

console.log(metrics.logsSent); // Total logs sent
console.log(metrics.logsDropped); // Logs dropped (buffer full)
console.log(metrics.errors); // Send errors
console.log(metrics.retries); // Retry attempts
console.log(metrics.avgLatencyMs); // Average send latency
console.log(metrics.circuitBreakerTrips); // Circuit breaker openings

// Get circuit breaker state
console.log(client.getCircuitBreakerState()); // 'CLOSED' | 'OPEN' | 'HALF_OPEN'

// Reset metrics
client.resetMetrics();
```

---

## Middleware

### Express Middleware

Auto-log all HTTP requests and responses.

```typescript
import express from 'express';
import { LogTideClient, logTideMiddleware } from '@logtide/sdk-node';

const app = express();
const logger = new LogTideClient({
  apiUrl: 'http://localhost:8080',
  apiKey: 'lp_your_api_key_here',
});

app.use(
  logTideMiddleware({
    client: logger,
    serviceName: 'express-api',
    logRequests: true,
    logResponses: true,
    logErrors: true,
    includeHeaders: false,
    includeBody: false,
    skipHealthCheck: true,
    skipPaths: ['/metrics'],
  }),
);

app.get('/', (req, res) => {
  res.json({ message: 'Hello' });
});

app.listen(3000);
```

**Logged automatically:**
- Request: `GET /users/123`
- Response: `GET /users/123 200 (45ms)`
- Errors: `Request error: Internal Server Error`

### Fastify Plugin

```typescript
import Fastify from 'fastify';
import { LogTideClient, logTideFastifyPlugin } from '@logtide/sdk-node';

const fastify = Fastify();
const logger = new LogTideClient({
  apiUrl: 'http://localhost:8080',
  apiKey: 'lp_your_api_key_here',
});

await fastify.register(logTideFastifyPlugin, {
  client: logger,
  serviceName: 'fastify-api',
  logRequests: true,
  logResponses: true,
  logErrors: true,
  skipHealthCheck: true,
});

fastify.get('/', async () => ({ message: 'Hello' }));

await fastify.listen({ port: 3000 });
```

---

## Best Practices

### 1. Always Close on Shutdown

```typescript
process.on('SIGINT', async () => {
  await client.close(); // Flushes buffered logs
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await client.close();
  process.exit(0);
});
```

### 2. Use Global Metadata

```typescript
const client = new LogTideClient({
  apiUrl: 'http://localhost:8080',
  apiKey: 'lp_your_api_key_here',
  globalMetadata: {
    env: process.env.NODE_ENV,
    version: require('./package.json').version,
    region: process.env.AWS_REGION,
    pod: process.env.HOSTNAME,
  },
});
```

### 3. Enable Debug Mode in Development

```typescript
const client = new LogTideClient({
  apiUrl: 'http://localhost:8080',
  apiKey: 'lp_your_api_key_here',
  debug: process.env.NODE_ENV === 'development',
});
```

### 4. Monitor Metrics in Production

```typescript
setInterval(() => {
  const metrics = client.getMetrics();

  if (metrics.logsDropped > 0) {
    console.warn(`Logs dropped: ${metrics.logsDropped}`);
  }

  if (metrics.circuitBreakerTrips > 0) {
    console.error('Circuit breaker is OPEN!');
  }
}, 60000);
```

### 5. Use Trace IDs for Request Correlation

```typescript
app.use((req, res, next) => {
  const traceId = req.headers['x-trace-id'] || randomUUID();
  req.traceId = traceId;

  client.withTraceId(traceId, () => {
    next();
  });
});
```

---

## API Reference

### LogTideClient

#### Constructor
```typescript
new LogTideClient(options: LogTideClientOptions)
```

#### Logging Methods
- `log(entry: LogEntry): void`
- `debug(service: string, message: string, metadata?: object): void`
- `info(service: string, message: string, metadata?: object): void`
- `warn(service: string, message: string, metadata?: object): void`
- `error(service: string, message: string, metadataOrError?: object | Error): void`
- `critical(service: string, message: string, metadataOrError?: object | Error): void`

#### Context Methods
- `setTraceId(traceId: string | null): void`
- `getTraceId(): string | null`
- `withTraceId<T>(traceId: string, fn: () => T): T`
- `withNewTraceId<T>(fn: () => T): T`

#### Query Methods
- `query(options: QueryOptions): Promise<LogsResponse>`
- `getByTraceId(traceId: string): Promise<InternalLogEntry[]>`
- `getAggregatedStats(options: AggregatedStatsOptions): Promise<AggregatedStatsResponse>`

#### Streaming
- `stream(options: StreamOptions): () => void` (returns cleanup function)

#### Metrics
- `getMetrics(): ClientMetrics`
- `resetMetrics(): void`
- `getCircuitBreakerState(): string`

#### Lifecycle
- `flush(): Promise<void>`
- `close(): Promise<void>`

---

## Examples

See the [examples/](./examples) directory for complete working examples:

- **[basic.ts](./examples/basic.ts)** - Simple usage
- **[advanced.ts](./examples/advanced.ts)** - All advanced features
- **[express-middleware.ts](./examples/express-middleware.ts)** - Express integration
- **[fastify-plugin.ts](./examples/fastify-plugin.ts)** - Fastify integration

---

## TypeScript Support

Fully typed with strict TypeScript support:

```typescript
import type {
  LogTideClient,
  LogEntry,
  QueryOptions,
  LogsResponse,
  ClientMetrics,
} from '@logtide/sdk-node';
```

---

## Testing

Run the test suite:

```bash
# Run tests
pnpm test

# Watch mode
pnpm test:watch

# Coverage
pnpm test:coverage
```

---

## License

MIT

---

## Contributing

Contributions are welcome! Please open an issue or PR on [GitHub](https://github.com/logtide/logtide-sdk-node).

---

## Support

- **Documentation**: [https://logtide.dev/docs](https://logtide.dev/docs)
- **Issues**: [GitHub Issues](https://github.com/logtide/logtide-sdk-node/issues)
