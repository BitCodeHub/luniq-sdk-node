/*!
 * @luniq/node — Luniq SDK for Node.js v1.0.0
 * Server-side event tracking, identify, and feature flag evaluation.
 */
"use strict";

const { randomUUID } = require("crypto");

class Luniq {
  /**
   * @param {object} opts
   * @param {string} opts.apiKey   API key from your Luniq dashboard (write or admin scope).
   * @param {string} [opts.endpoint="https://uselunaai.com"]  Base URL of your Luniq deployment.
   * @param {string} [opts.environment="PRD"]
   * @param {string} [opts.brand]   Optional brand/tenant short code added to every event.
   * @param {number} [opts.flushIntervalMs=10000]
   * @param {number} [opts.maxQueueSize=10000]
   * @param {boolean} [opts.redactPII=true]
   */
  constructor(opts) {
    if (!opts || !opts.apiKey) throw new Error("Luniq: apiKey required");
    this.cfg = Object.assign(
      { endpoint: "https://uselunaai.com", environment: "PRD", flushIntervalMs: 10000, maxQueueSize: 10000, redactPII: true },
      opts,
    );
    this.cfg.endpoint = String(this.cfg.endpoint).replace(/\/+$/, "");
    this.queue = [];
    this.flagCache = new Map(); // visitorId -> { flagKey: variant }
    this._timer = setInterval(() => this.flush().catch(() => {}), this.cfg.flushIntervalMs);
    if (this._timer.unref) this._timer.unref();
  }

  /** Track an event. Server-side fire-and-batch. */
  track(name, { visitorId, accountId, properties = {}, timestamp } = {}) {
    if (!visitorId) throw new Error("track(): visitorId required");
    const props = Object.assign({}, properties, {
      os_type: "SERVER",
      env: this.cfg.environment,
    });
    if (this.cfg.brand) props.brand = this.cfg.brand;
    if (this.cfg.redactPII) redactObject(props);
    const ev = {
      id: randomUUID(),
      name: String(name),
      properties: props,
      timestamp: (timestamp instanceof Date ? timestamp : new Date()).toISOString(),
      sessionId: null,
      visitorId: String(visitorId),
      accountId: accountId ? String(accountId) : null,
    };
    this.queue.push(ev);
    if (this.queue.length > this.cfg.maxQueueSize) {
      this.queue.splice(0, this.queue.length - this.cfg.maxQueueSize);
    }
  }

  /** Identify (no-op server side beyond marking — used for downstream stitching). */
  identify({ visitorId, accountId, traits } = {}) {
    return this.track("$identify", {
      visitorId, accountId, properties: traits || {},
    });
  }

  /** Evaluate feature flags for a user. Returns { flagKey: variant|bool|false }. */
  async flags({ visitorId, accountId, traits = {} } = {}) {
    if (!visitorId) throw new Error("flags(): visitorId required");
    const r = await fetch(`${this.cfg.endpoint}/v1/sdk/flags/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Luniq-Key": this.cfg.apiKey },
      body: JSON.stringify({ visitorId, accountId: accountId || "", traits }),
    });
    if (!r.ok) return {};
    const j = await r.json();
    this.flagCache.set(visitorId, j);
    return j;
  }

  /** Synchronous getter (call await flags() first to populate cache). */
  flag(visitorId, key) {
    const m = this.flagCache.get(visitorId);
    if (!m) return false;
    return m[key] === undefined ? false : m[key];
  }

  /** Flush queued events. Auto-called on interval; call manually before process exit. */
  async flush() {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, 100);
    try {
      const r = await fetch(`${this.cfg.endpoint}/v1/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Luniq-Key": this.cfg.apiKey },
        body: JSON.stringify({ events: batch }),
      });
      if (!r.ok) this.queue.unshift(...batch);
    } catch (e) {
      this.queue.unshift(...batch);
    }
  }

  /** Stop the flush timer. Useful in serverless / one-shot scripts. */
  async shutdown() {
    if (this._timer) clearInterval(this._timer);
    await this.flush();
  }
}

// PII redaction patterns
const PII = [
  { re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, sub: "[email]" },
  { re: /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, sub: "[phone]" },
  { re: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g, sub: "[card]" },
  { re: /\b\d{3}-\d{2}-\d{4}\b/g, sub: "[ssn]" },
];
function redactValue(v) {
  if (typeof v !== "string") return v;
  let out = v;
  for (const p of PII) out = out.replace(p.re, p.sub);
  return out;
}
function redactObject(o) {
  for (const k in o) if (typeof o[k] === "string") o[k] = redactValue(o[k]);
  return o;
}

module.exports = { Luniq };
module.exports.default = Luniq;
