# @pulse/node

Server-side SDK for [Pulse](https://luniq.ai). Track events, identify users,
and evaluate feature flags from any Node.js backend.

## Install

```bash
npm install @pulse/node
```

## Usage

```js
import { Luniq } from "@pulse/node";

const pulse = new Luniq({
  apiKey:   process.env.PULSE_API_KEY,
  endpoint: "https://your-luniq-host.com",
  environment: "PRD",
});

// Track from a backend route
app.post("/api/orders", async (req, res) => {
  const order = await db.orders.create(req.body);
  pulse.track("order_placed", {
    visitorId: req.user.visitorId,
    accountId: req.user.id,
    properties: { amount: order.total, sku_count: order.items.length },
  });
  res.json(order);
});

// Server-side feature flag evaluation
app.get("/api/checkout", async (req, res) => {
  const flags = await pulse.flags({ visitorId: req.user.visitorId, traits: { plan: req.user.plan } });
  if (flags.new_checkout_v2) {
    return res.redirect("/checkout/v2");
  }
  res.redirect("/checkout/v1");
});

// On graceful shutdown (Express signal handler, etc.)
process.on("SIGTERM", async () => { await pulse.shutdown(); });
```

## API

### `new Luniq(opts)`
- `apiKey` (required) — workspace API key with `write` or `admin` scope
- `endpoint` (required) — base URL of your Pulse deployment
- `environment` — `PRD` / `STG` / `DEV`
- `flushIntervalMs` — default 10000
- `maxQueueSize` — default 10000
- `redactPII` — default `true`; auto-redacts emails, phones, cards, SSNs

### `track(name, { visitorId, accountId, properties, timestamp })`
Buffers an event for batched async upload.

### `identify({ visitorId, accountId, traits })`
Emits `$identify` with the trait set.

### `flags({ visitorId, accountId, traits })`
Async — fetches the current flag evaluation from Pulse for this user. Cached for sync access via `flag(visitorId, key)`.

### `flag(visitorId, key)`
Sync — returns cached flag value (call `flags()` once before).

### `flush()`
Force flush the queue. Auto-called on interval.

### `shutdown()`
Stops the timer and flushes one last time. Call before process exit.

## License

Apache-2.0.
