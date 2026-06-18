import { describe, expect, test } from "bun:test";
import { openDb } from "../src/store/db";
import { configRoutes } from "../src/routes/config";

function ctx(db: ReturnType<typeof openDb>, request: Request) {
  return { db, log: () => {}, loop: { start() {}, stop() {} } as never, url: new URL(request.url), params: {}, request };
}

describe("GET /api/config", () => {
  test("includes the detected claudeConfigDirs", async () => {
    const db = openDb(":memory:");
    const routes = configRoutes({ claudeConfigDirs: () => [{ path: "/home/u/.claude", profile: "default" }] });
    const get = routes.find((r) => r.method === "GET")!;
    const res = await get.handler(ctx(db, new Request("http://x/api/config")) as never);
    const body = await res.json();
    expect(body.claudeConfigDirs).toEqual([{ path: "/home/u/.claude", profile: "default" }]);
  });
});
