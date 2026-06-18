import { describe, expect, test } from "bun:test";
import { openDb } from "../src/store/db";
import { setBbsConfig } from "../src/store/config";
import { bbsRoutes } from "../src/routes/bbs";

function ctx(db: ReturnType<typeof openDb>, request: Request) {
  return { db, log: () => {}, loop: { start() {}, stop() {} } as never, url: new URL(request.url), params: {}, request };
}
const publisher = { status: () => ({ lastOk: null, lastError: null }), sendTest: async () => {} } as never;

describe("bbs routes", () => {
  test("GET /api/bbs/config masks the keys", async () => {
    const db = openDb(":memory:");
    setBbsConfig(db, { accountKey: "ak_secret1234", screenId: "abc", screenKey: "sk_secret9999", enabled: true });
    const routes = bbsRoutes({ client: {} as never, publisher });
    const get = routes.find((r) => r.method === "GET" && String(r.pattern).includes("config"))!;
    const body = await (await get.handler(ctx(db, new Request("http://x/api/bbs/config")) as never)).json();
    expect(body.accountKey).toBe("••••1234");
    expect(body.screenKey).toBe("••••9999");
    expect(body.screenUrl).toBe("https://app.bigbeautifulscreens.com/screen/abc");
    expect(body.enabled).toBe(true);
  });

  test("POST /api/bbs/provision creates a screen when none stored", async () => {
    const db = openDb(":memory:");
    setBbsConfig(db, { accountKey: "ak_x" });
    const calls: string[] = [];
    const client = {
      screenExists: async () => false,
      createScreen: async () => { calls.push("create"); return { screen_id: "new1", api_key: "sk_new", screen_url: "/screen/new1" }; },
      updateScreen: async () => { calls.push("update"); },
    } as never;
    const routes = bbsRoutes({ client, publisher });
    const prov = routes.find((r) => String(r.pattern).includes("provision"))!;
    const body = await (await prov.handler(ctx(db, new Request("http://x/api/bbs/provision", { method: "POST" })) as never)).json();
    expect(calls).toEqual(["create", "update"]);
    expect(body.screenId).toBe("new1");
  });

  test("POST /api/bbs/provision reuses an existing valid screen", async () => {
    const db = openDb(":memory:");
    setBbsConfig(db, { accountKey: "ak_x", screenId: "keep", screenKey: "sk_keep" });
    const calls: string[] = [];
    const client = {
      screenExists: async () => true,
      createScreen: async () => { calls.push("create"); return { screen_id: "x", api_key: "y", screen_url: "z" }; },
      updateScreen: async () => { calls.push("update"); },
    } as never;
    const routes = bbsRoutes({ client, publisher });
    const prov = routes.find((r) => String(r.pattern).includes("provision"))!;
    await prov.handler(ctx(db, new Request("http://x/api/bbs/provision", { method: "POST" })) as never);
    expect(calls).toEqual(["update"]); // no create
  });

  test("POST /api/bbs/provision 400s without an account key", async () => {
    const db = openDb(":memory:");
    const routes = bbsRoutes({ client: {} as never, publisher });
    const prov = routes.find((r) => String(r.pattern).includes("provision"))!;
    const res = await prov.handler(ctx(db, new Request("http://x/api/bbs/provision", { method: "POST" })) as never);
    expect(res.status).toBe(400);
  });
});
