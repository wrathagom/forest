import { describe, expect, test } from "bun:test";
import { openDb } from "../src/store/db";
import { PhraseStore } from "../src/phrases/store";
import { PhraseIndexBuilder } from "../src/phrases/builder";
import { phrasesRoutes } from "../src/routes/phrases";

function ctx(db: ReturnType<typeof openDb>, request: Request) {
  return { db, log: () => {}, loop: {} as never, url: new URL(request.url), params: {}, request };
}

function deps(db: ReturnType<typeof openDb>) {
  return { store: new PhraseStore(db), builder: new PhraseIndexBuilder(db, { minTotal: 1 }) };
}

describe("GET /api/phrases", () => {
  test("returns a leaderboard for the given n", async () => {
    const db = openDb(":memory:");
    db.query("INSERT INTO agent_ngrams (agent,n,phrase,month,count) VALUES ('claude',3,'take a look','2026-06',9)").run();
    const routes = phrasesRoutes(deps(db));
    const route = routes.find((r) => r.pattern.test("/api/phrases") && r.method === "GET")!;
    const res = await route.handler(ctx(db, new Request("http://x/api/phrases?n=3")) as never);
    const body = await res.json();
    expect(body.phrases[0]).toMatchObject({ phrase: "take a look", count: 9 });
  });
});

describe("GET /api/phrases/occurrences", () => {
  test("400s without a phrase", async () => {
    const db = openDb(":memory:");
    const routes = phrasesRoutes(deps(db));
    const route = routes.find((r) => r.pattern.test("/api/phrases/occurrences"))!;
    const res = await route.handler(ctx(db, new Request("http://x/api/phrases/occurrences")) as never);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/phrases/status", () => {
  test("reports never-built state", async () => {
    const db = openDb(":memory:");
    const routes = phrasesRoutes(deps(db));
    const route = routes.find((r) => r.pattern.test("/api/phrases/status"))!;
    const res = await route.handler(ctx(db, new Request("http://x/api/phrases/status")) as never);
    const body = await res.json();
    expect(body.lastBuiltAt).toBeNull();
  });
});
