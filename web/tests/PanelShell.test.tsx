import { render, screen } from "@solidjs/testing-library";
import { describe, expect, test, vi } from "vitest";
import PanelShell from "../src/components/PanelShell";

type Item = { id: string; label: string };

describe("PanelShell", () => {
  test("renders the title", () => {
    render(() => (
      <PanelShell
        title="Test"
        fetcher={async () => [{ id: "1", label: "x" }] as Item[]}
        pollMs={0}
        enabled={() => false}
        keyField={"id" as const}
      >
        {(rows) => <div>{rows.length}</div>}
      </PanelShell>
    ));
    expect(screen.getByText("Test")).toBeTruthy();
  });

  test("invokes fetcher and renders children with data", async () => {
    const items: Item[] = [{ id: "1", label: "a" }, { id: "2", label: "b" }, { id: "3", label: "c" }];
    const fetcher = vi.fn(async () => items);
    render(() => (
      <PanelShell
        title="Test"
        fetcher={fetcher}
        pollMs={0}
        enabled={() => true}
        keyField={"id" as const}
      >
        {(rows) => <ul>{rows.map((r) => <li>{r.label}</li>)}</ul>}
      </PanelShell>
    ));
    await new Promise((r) => setTimeout(r, 30));
    expect(fetcher).toHaveBeenCalled();
    expect(screen.getByText("a")).toBeTruthy();
    expect(screen.getByText("b")).toBeTruthy();
  });

  test("renders error banner with retry button on fetch failure", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("boom");
    });
    render(() => (
      <PanelShell
        title="Test"
        fetcher={fetcher as () => Promise<Item[]>}
        pollMs={0}
        enabled={() => true}
        keyField={"id" as const}
      >
        {() => <div>data</div>}
      </PanelShell>
    ));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByText(/boom/)).toBeTruthy();
    expect(screen.getByText("retry")).toBeTruthy();
  });

  test("does not fetch when disabled", async () => {
    const fetcher = vi.fn(async () => [{ id: "1", label: "x" }] as Item[]);
    render(() => (
      <PanelShell
        title="Test"
        fetcher={fetcher}
        pollMs={0}
        enabled={() => false}
        keyField={"id" as const}
      >
        {() => <div>data</div>}
      </PanelShell>
    ));
    await new Promise((r) => setTimeout(r, 30));
    expect(fetcher).not.toHaveBeenCalled();
  });
});
