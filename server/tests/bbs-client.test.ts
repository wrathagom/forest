import { describe, expect, test } from "bun:test";
import { BbsClient } from "../src/bbs/client";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

function mockFetch(handler: (call: Call) => { status?: number; json?: unknown }) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    const call: Call = { url: String(url), method: init.method ?? "GET", headers, body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const r = handler(call);
    return new Response(r.json === undefined ? "" : JSON.stringify(r.json), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("BbsClient", () => {
  test("createScreen posts with account key and returns body", async () => {
    const { fn, calls } = mockFetch(() => ({ json: { screen_id: "s1", api_key: "sk_1", screen_url: "/screen/s1" } }));
    const client = new BbsClient({ baseUrl: "https://bbs.test", fetch: fn });
    const out = await client.createScreen("ak_acc", "Forest HUD");
    expect(out).toEqual({ screen_id: "s1", api_key: "sk_1", screen_url: "/screen/s1" });
    expect(calls[0].url).toBe("https://bbs.test/api/v1/screens");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers["X-API-Key"]).toBe("ak_acc");
    expect(calls[0].body).toEqual({ name: "Forest HUD" });
  });

  test("screenExists is true on 200, false on 404", async () => {
    const ok = new BbsClient({ baseUrl: "https://bbs.test", fetch: mockFetch(() => ({ status: 200 })).fn });
    const missing = new BbsClient({ baseUrl: "https://bbs.test", fetch: mockFetch(() => ({ status: 404 })).fn });
    expect(await ok.screenExists("ak", "s1")).toBe(true);
    expect(await missing.screenExists("ak", "s1")).toBe(false);
  });

  test("putPage sends screen key, body, and expires_at", async () => {
    const { fn, calls } = mockFetch(() => ({ status: 200 }));
    const client = new BbsClient({ baseUrl: "https://bbs.test", fetch: fn });
    await client.putPage("sk_1", "s1", "alert-x", { content: ["hi"], expires_at: "2026-01-01T00:00:00.000Z" });
    expect(calls[0].url).toBe("https://bbs.test/api/v1/screens/s1/pages/alert-x");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers["X-API-Key"]).toBe("sk_1");
    expect(calls[0].body).toEqual({ content: ["hi"], expires_at: "2026-01-01T00:00:00.000Z" });
  });

  test("deletePage tolerates 404 but throws on 500", async () => {
    const okMissing = new BbsClient({ baseUrl: "https://bbs.test", fetch: mockFetch(() => ({ status: 404 })).fn });
    await okMissing.deletePage("sk", "s1", "alert-x"); // no throw
    const boom = new BbsClient({ baseUrl: "https://bbs.test", fetch: mockFetch(() => ({ status: 500 })).fn });
    await expect(boom.deletePage("sk", "s1", "alert-x")).rejects.toThrow();
  });

  test("screenExists throws on a 500 (does not report 'missing')", async () => {
    const boom = new BbsClient({ baseUrl: "https://bbs.test", fetch: mockFetch(() => ({ status: 500 })).fn });
    await expect(boom.screenExists("ak", "s1")).rejects.toThrow();
  });

  test("createScreen throws on a non-ok response", async () => {
    const boom = new BbsClient({ baseUrl: "https://bbs.test", fetch: mockFetch(() => ({ status: 403 })).fn });
    await expect(boom.createScreen("ak", "Forest HUD")).rejects.toThrow();
  });
});
