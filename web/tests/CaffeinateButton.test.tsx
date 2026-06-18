import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor } from "@solidjs/testing-library";
import CaffeinateButton from "../src/components/CaffeinateButton";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  // @ts-expect-error – inject global fetch
  globalThis.fetch = fetchMock;
});
afterEach(() => { fetchMock.mockReset(); });

function statusResponse(body: object) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

test("renders nothing when supported: false", async () => {
  fetchMock.mockResolvedValueOnce(statusResponse({ supported: false, active: false, endsAt: null, indefinite: false }));
  const { container } = render(() => <CaffeinateButton />);
  // The component should never render any .caffeinate root once the response is processed.
  // Wait until the fetch resolves (microtask) then assert nothing is rendered.
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  // Flush the microtask that applies the response.
  await Promise.resolve();
  expect(container.querySelector(".caffeinate")).toBeNull();
  expect(container.querySelector(".caffeinate-button")).toBeNull();
});

test("renders with caffeinate-off class when inactive", async () => {
  fetchMock.mockResolvedValueOnce(statusResponse({ supported: true, active: false, endsAt: null, indefinite: false }));
  const { container } = render(() => <CaffeinateButton />);
  await waitFor(() => expect(container.querySelector(".caffeinate-off")).not.toBeNull());
});

test("renders with caffeinate-on class and remaining-time tooltip when timed", async () => {
  const endsAt = Date.now() + 90 * 60 * 1000; // 1h 30m
  fetchMock.mockResolvedValueOnce(statusResponse({ supported: true, active: true, endsAt, indefinite: false }));
  const { container } = render(() => <CaffeinateButton />);
  const btn = await waitFor(() => {
    const b = container.querySelector(".caffeinate-on");
    expect(b).not.toBeNull();
    return b as HTMLElement;
  });
  expect(btn.getAttribute("title")).toMatch(/caffeinated/);
  expect(btn.getAttribute("title")).toMatch(/1h 30m/);
});

test("renders indefinite tooltip when indefinite", async () => {
  fetchMock.mockResolvedValueOnce(statusResponse({ supported: true, active: true, endsAt: null, indefinite: true }));
  const { container } = render(() => <CaffeinateButton />);
  const btn = await waitFor(() => {
    const b = container.querySelector(".caffeinate-on");
    expect(b).not.toBeNull();
    return b as HTMLElement;
  });
  expect(btn.getAttribute("title")).toMatch(/indefinite/);
});

test("clicking while inactive opens the menu with five options", async () => {
  fetchMock.mockResolvedValueOnce(statusResponse({ supported: true, active: false, endsAt: null, indefinite: false }));
  const { container, getByText } = render(() => <CaffeinateButton />);
  const btn = await waitFor(() => {
    const b = container.querySelector(".caffeinate-button");
    expect(b).not.toBeNull();
    return b as HTMLElement;
  });
  fireEvent.click(btn);
  expect(getByText("1 hour")).toBeTruthy();
  expect(getByText("2 hours")).toBeTruthy();
  expect(getByText("4 hours")).toBeTruthy();
  expect(getByText("8 hours")).toBeTruthy();
  expect(getByText("Indefinite")).toBeTruthy();
});

test("picking a duration POSTs and updates state", async () => {
  fetchMock.mockResolvedValueOnce(statusResponse({ supported: true, active: false, endsAt: null, indefinite: false }));
  fetchMock.mockResolvedValueOnce(statusResponse({ supported: true, active: true, endsAt: Date.now() + 3600_000, indefinite: false }));
  const { container, getByText } = render(() => <CaffeinateButton />);
  const btn = await waitFor(() => {
    const b = container.querySelector(".caffeinate-button");
    expect(b).not.toBeNull();
    return b as HTMLElement;
  });
  fireEvent.click(btn);
  fireEvent.click(getByText("1 hour"));
  await waitFor(() => expect(container.querySelector(".caffeinate-on")).not.toBeNull());
  expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/caffeinate", expect.objectContaining({
    method: "POST",
    body: JSON.stringify({ durationSec: 3600 }),
  }));
});

test("clicking while active DELETEs (no menu)", async () => {
  fetchMock.mockResolvedValueOnce(statusResponse({ supported: true, active: true, endsAt: Date.now() + 3600_000, indefinite: false }));
  fetchMock.mockResolvedValueOnce(statusResponse({ supported: true, active: false, endsAt: null, indefinite: false }));
  const { container, queryByText } = render(() => <CaffeinateButton />);
  const btn = await waitFor(() => {
    const b = container.querySelector(".caffeinate-on");
    expect(b).not.toBeNull();
    return b as HTMLElement;
  });
  fireEvent.click(btn);
  await waitFor(() => expect(container.querySelector(".caffeinate-off")).not.toBeNull());
  expect(queryByText("1 hour")).toBeNull();
  expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/caffeinate", expect.objectContaining({ method: "DELETE" }));
});

test("API failure during start shows error dot and overrides tooltip", async () => {
  fetchMock.mockResolvedValueOnce(statusResponse({ supported: true, active: false, endsAt: null, indefinite: false }));
  fetchMock.mockRejectedValueOnce(new Error("network error"));
  const { container, getByText } = render(() => <CaffeinateButton />);
  const btn = await waitFor(() => {
    const b = container.querySelector(".caffeinate-button");
    expect(b).not.toBeNull();
    return b as HTMLElement;
  });
  fireEvent.click(btn); // opens menu
  fireEvent.click(getByText("1 hour")); // triggers POST which will reject
  await waitFor(() => expect(container.querySelector(".caffeinate-error-dot")).not.toBeNull());
  expect(btn.getAttribute("title")).toMatch(/network error/);
});
