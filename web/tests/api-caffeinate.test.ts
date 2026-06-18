import { test, expect, vi, afterEach, beforeEach } from "vitest";
import { fetchCaffeinateStatus, startCaffeinate, stopCaffeinate } from "../src/api";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  // @ts-expect-error – inject global fetch
  globalThis.fetch = fetchMock;
});

test("fetchCaffeinateStatus GETs and returns body", async () => {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ supported: true, active: false, endsAt: null, indefinite: false }), { status: 200, headers: { "content-type": "application/json" } }));
  const s = await fetchCaffeinateStatus();
  expect(fetchMock).toHaveBeenCalledWith("/api/caffeinate");
  expect(s.active).toBe(false);
});

test("startCaffeinate POSTs durationSec", async () => {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ supported: true, active: true, endsAt: 1000, indefinite: false }), { status: 200, headers: { "content-type": "application/json" } }));
  const s = await startCaffeinate(3600);
  expect(fetchMock).toHaveBeenCalledWith("/api/caffeinate", expect.objectContaining({
    method: "POST",
    body: JSON.stringify({ durationSec: 3600 }),
  }));
  expect(s.active).toBe(true);
});

test("startCaffeinate POSTs null for indefinite", async () => {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ supported: true, active: true, endsAt: null, indefinite: true }), { status: 200, headers: { "content-type": "application/json" } }));
  await startCaffeinate(null);
  expect(fetchMock).toHaveBeenCalledWith("/api/caffeinate", expect.objectContaining({
    body: JSON.stringify({ durationSec: null }),
  }));
});

test("stopCaffeinate DELETEs", async () => {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ supported: true, active: false, endsAt: null, indefinite: false }), { status: 200, headers: { "content-type": "application/json" } }));
  await stopCaffeinate();
  expect(fetchMock).toHaveBeenCalledWith("/api/caffeinate", expect.objectContaining({ method: "DELETE" }));
});

afterEach(() => { fetchMock.mockReset(); });
