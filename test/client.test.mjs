import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Luniq } from "../index.js";

const ENDPOINT = "https://luniq.test";
const API_KEY = "test-api-key";

function mockOk(body = {}) {
  return { ok: true, status: 200, json: async () => body };
}
function mockErr(status = 500) {
  return { ok: false, status, json: async () => ({}) };
}

describe("Luniq Node SDK", () => {
  let fetchMock;
  let client;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(mockOk());
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    if (client && client._timer) clearInterval(client._timer);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("throws without apiKey", () => {
      expect(() => new Luniq({ endpoint: ENDPOINT })).toThrow(/apiKey required/);
    });

    it("defaults endpoint to https://uselunaai.com when omitted", () => {
      const c = new Luniq({ apiKey: API_KEY });
      expect(c.cfg.endpoint).toBe("https://uselunaai.com");
    });

    it("strips trailing slashes from endpoint", () => {
      client = new Luniq({ apiKey: API_KEY, endpoint: ENDPOINT + "///" });
      expect(client.cfg.endpoint).toBe(ENDPOINT);
    });
  });

  describe("track()", () => {
    beforeEach(() => {
      client = new Luniq({ apiKey: API_KEY, endpoint: ENDPOINT, flushIntervalMs: 60_000 });
    });

    it("buffers events without sending immediately", () => {
      client.track("page_view", { visitorId: "v1", properties: { path: "/home" } });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(client.queue.length).toBe(1);
      expect(client.queue[0].name).toBe("page_view");
      expect(client.queue[0].visitorId).toBe("v1");
      // server-side defaults
      expect(client.queue[0].properties.os_type).toBe("SERVER");
      expect(client.queue[0].properties.env).toBe("PRD");
    });

    it("requires visitorId", () => {
      expect(() => client.track("foo", {})).toThrow(/visitorId required/);
    });

    it("trims queue when over maxQueueSize", () => {
      const small = new Luniq({
        apiKey: API_KEY, endpoint: ENDPOINT, flushIntervalMs: 60_000, maxQueueSize: 2,
      });
      try {
        small.track("a", { visitorId: "v" });
        small.track("b", { visitorId: "v" });
        small.track("c", { visitorId: "v" });
        expect(small.queue.length).toBe(2);
        expect(small.queue.map((e) => e.name)).toEqual(["b", "c"]);
      } finally {
        clearInterval(small._timer);
      }
    });
  });

  describe("flush()", () => {
    beforeEach(() => {
      client = new Luniq({ apiKey: API_KEY, endpoint: ENDPOINT, flushIntervalMs: 60_000 });
    });

    it("POSTs to /v1/events with the X-Luniq-Key header", async () => {
      client.track("clicked", { visitorId: "v1", properties: { x: 1 } });
      await client.flush();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`${ENDPOINT}/v1/events`);
      expect(init.method).toBe("POST");
      expect(init.headers["X-Luniq-Key"]).toBe(API_KEY);
      expect(init.headers["Content-Type"]).toBe("application/json");

      const body = JSON.parse(init.body);
      expect(Array.isArray(body.events)).toBe(true);
      expect(body.events.length).toBe(1);
      expect(body.events[0].name).toBe("clicked");
      expect(client.queue.length).toBe(0);
    });

    it("is a no-op when queue is empty", async () => {
      await client.flush();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("identify()", () => {
    beforeEach(() => {
      client = new Luniq({ apiKey: API_KEY, endpoint: ENDPOINT, flushIntervalMs: 60_000 });
    });

    it("sends an $identify event with the traits", async () => {
      client.identify({
        visitorId: "v1",
        accountId: "a1",
        traits: { plan: "pro", role: "admin" },
      });
      await client.flush();

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.events.length).toBe(1);
      const ev = body.events[0];
      expect(ev.name).toBe("$identify");
      expect(ev.visitorId).toBe("v1");
      expect(ev.accountId).toBe("a1");
      expect(ev.properties.plan).toBe("pro");
      expect(ev.properties.role).toBe("admin");
    });
  });

  describe("PII redaction", () => {
    it("redacts emails from string properties before sending", async () => {
      client = new Luniq({ apiKey: API_KEY, endpoint: ENDPOINT, flushIntervalMs: 60_000 });
      client.track("note", {
        visitorId: "v1",
        properties: { msg: "email: foo@bar.com sent" },
      });
      await client.flush();

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      const sent = body.events[0].properties.msg;
      expect(sent).not.toContain("foo@bar.com");
      expect(sent).toContain("[email]");
    });

    it("redacts phone, card, SSN patterns too", async () => {
      client = new Luniq({ apiKey: API_KEY, endpoint: ENDPOINT, flushIntervalMs: 60_000 });
      client.track("note", {
        visitorId: "v1",
        properties: {
          phone: "call 415-555-1234 today",
          card: "card 4111 1111 1111 1111",
          ssn: "ssn 123-45-6789",
        },
      });
      await client.flush();
      const props = JSON.parse(fetchMock.mock.calls[0][1].body).events[0].properties;
      expect(props.phone).toContain("[phone]");
      expect(props.card).toContain("[card]");
      expect(props.ssn).toContain("[ssn]");
    });

    it("does not redact when redactPII=false", async () => {
      client = new Luniq({
        apiKey: API_KEY, endpoint: ENDPOINT, flushIntervalMs: 60_000, redactPII: false,
      });
      client.track("note", { visitorId: "v1", properties: { msg: "email: foo@bar.com" } });
      await client.flush();
      const sent = JSON.parse(fetchMock.mock.calls[0][1].body).events[0].properties.msg;
      expect(sent).toContain("foo@bar.com");
    });
  });

  describe("flags() / flag()", () => {
    beforeEach(() => {
      client = new Luniq({ apiKey: API_KEY, endpoint: ENDPOINT, flushIntervalMs: 60_000 });
    });

    it("flag() returns false before flags() is called", () => {
      expect(client.flag("v1", "new_checkout")).toBe(false);
    });

    it("flags() POSTs to /v1/sdk/flags/evaluate; flag() returns cached value after", async () => {
      fetchMock.mockResolvedValueOnce(mockOk({ new_checkout: "v2", beta: true }));

      const result = await client.flags({ visitorId: "v1", traits: { plan: "pro" } });
      expect(result).toEqual({ new_checkout: "v2", beta: true });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`${ENDPOINT}/v1/sdk/flags/evaluate`);
      expect(init.method).toBe("POST");
      expect(init.headers["X-Luniq-Key"]).toBe(API_KEY);
      const body = JSON.parse(init.body);
      expect(body.visitorId).toBe("v1");
      expect(body.traits).toEqual({ plan: "pro" });

      // Cached sync access
      expect(client.flag("v1", "new_checkout")).toBe("v2");
      expect(client.flag("v1", "beta")).toBe(true);
      expect(client.flag("v1", "missing")).toBe(false);
    });

    it("flags() returns {} on non-ok response and does not cache", async () => {
      fetchMock.mockResolvedValueOnce(mockErr(500));
      const result = await client.flags({ visitorId: "v1" });
      expect(result).toEqual({});
      expect(client.flag("v1", "anything")).toBe(false);
    });

    it("flags() requires visitorId", async () => {
      await expect(client.flags({})).rejects.toThrow(/visitorId required/);
    });
  });

  describe("shutdown()", () => {
    it("clears the flush timer and drains the queue", async () => {
      client = new Luniq({ apiKey: API_KEY, endpoint: ENDPOINT, flushIntervalMs: 60_000 });
      const timer = client._timer;
      const clearSpy = vi.spyOn(globalThis, "clearInterval");

      client.track("e1", { visitorId: "v1" });
      client.track("e2", { visitorId: "v1" });
      await client.shutdown();

      expect(clearSpy).toHaveBeenCalledWith(timer);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe(`${ENDPOINT}/v1/events`);
      expect(client.queue.length).toBe(0);
    });
  });

  describe("failed delivery", () => {
    beforeEach(() => {
      client = new Luniq({ apiKey: API_KEY, endpoint: ENDPOINT, flushIntervalMs: 60_000 });
    });

    it("re-queues the batch when fetch rejects (network error)", async () => {
      fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
      client.track("e1", { visitorId: "v1" });
      client.track("e2", { visitorId: "v1" });

      // Should not throw
      await expect(client.flush()).resolves.toBeUndefined();

      // Events back on the queue
      expect(client.queue.length).toBe(2);
      expect(client.queue.map((e) => e.name)).toEqual(["e1", "e2"]);
    });

    it("re-queues the batch when server returns non-ok", async () => {
      fetchMock.mockResolvedValueOnce(mockErr(503));
      client.track("e1", { visitorId: "v1" });

      await expect(client.flush()).resolves.toBeUndefined();
      expect(client.queue.length).toBe(1);
      expect(client.queue[0].name).toBe("e1");
    });

    it("retry on next flush succeeds and clears the queue", async () => {
      fetchMock
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockResolvedValueOnce(mockOk());
      client.track("e1", { visitorId: "v1" });

      await client.flush(); // fails, re-queues
      expect(client.queue.length).toBe(1);

      await client.flush(); // succeeds
      expect(client.queue.length).toBe(0);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
