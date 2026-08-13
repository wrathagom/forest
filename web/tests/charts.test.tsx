import { test, expect } from "vitest";
import { render } from "@solidjs/testing-library";
import TokensOverTimeChart from "../src/components/charts/TokensOverTimeChart";
import TokensByProjectChart from "../src/components/charts/TokensByProjectChart";
import TokensByProfileChart from "../src/components/charts/TokensByProfileChart";
import type { TokensByProjectRow, TokensOverTimePoint } from "../src/api";

const bucket = (input = 0, output = 0, cache = 0) => ({ input, output, cache });

const days = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ day: `2026-04-${String(i + 1).padStart(2, "0")}`, input: i, output: i, cache: i, byProfile: {} as Record<string, ReturnType<typeof bucket>> }));

// The chart labels its y-axis top with the stack max, which is the cheapest
// honest read on "did the filters actually change the numbers".
const axisMax = (container: HTMLElement) => container.querySelector("text.chart-tick")!.textContent;

test("TokensOverTimeChart renders one bar group per data point", () => {
  const { container } = render(() => <TokensOverTimeChart data={days(30)} />);
  expect(container.querySelectorAll("g.totc-bar")).toHaveLength(30);
});

test("TokensOverTimeChart renders an empty-state when there is no data", () => {
  const { container } = render(() => <TokensOverTimeChart data={[]} />);
  expect(container.textContent).toContain("no data");
});

test("TokensOverTimeChart profile mode renders per-profile stacked segments", () => {
  const data: TokensOverTimePoint[] = [
    { day: "2026-04-01", input: 0, output: 0, cache: 0, byProfile: { work: bucket(100), personal: bucket(50) } },
    { day: "2026-04-02", input: 0, output: 0, cache: 0, byProfile: { work: bucket(20) } },
  ];
  const { container } = render(() => (
    <TokensOverTimeChart data={data} mode="profile" profiles={["work", "personal"]} colors={{ work: "#111111", personal: "#222222" }} />
  ));
  expect(container.querySelectorAll("g.totc-bar")).toHaveLength(2);
  // day 1 → 2 segments, day 2 → 1 segment
  expect(container.querySelectorAll("g.totc-bar rect").length).toBe(3);
  const fills = Array.from(container.querySelectorAll("g.totc-bar rect")).map((r) => (r as SVGElement).style.fill);
  expect(fills).toContain("rgb(17, 17, 17)");
});

test("TokensOverTimeChart profile mode honors the token-type filter too", () => {
  const data: TokensOverTimePoint[] = [
    { day: "2026-04-01", input: 100, output: 0, cache: 50, byProfile: { work: bucket(100, 0, 50) } },
  ];
  const all = render(() => <TokensOverTimeChart data={data} mode="profile" profiles={["work"]} />);
  expect(axisMax(all.container)).toBe("150");

  const noCache = render(() => (
    <TokensOverTimeChart data={data} mode="profile" profiles={["work"]} series={{ input: true, output: true, cache: false }} />
  ));
  expect(axisMax(noCache.container)).toBe("100");
});

test("TokensOverTimeChart type mode counts only the accounts it was given", () => {
  const data: TokensOverTimePoint[] = [
    { day: "2026-04-01", input: 150, output: 0, cache: 0, byProfile: { work: bucket(100), personal: bucket(50) } },
  ];
  const both = render(() => <TokensOverTimeChart data={data} mode="type" profiles={["work", "personal"]} />);
  expect(axisMax(both.container)).toBe("150");

  const workOnly = render(() => <TokensOverTimeChart data={data} mode="type" profiles={["work"]} />);
  expect(axisMax(workOnly.container)).toBe("100");
});

test("TokensOverTimeChart falls back to the flat totals when given no account list", () => {
  const data: TokensOverTimePoint[] = [
    { day: "2026-04-01", input: 150, output: 0, cache: 0, byProfile: { work: bucket(100), personal: bucket(50) } },
  ];
  const { container } = render(() => <TokensOverTimeChart data={data} mode="type" />);
  expect(axisMax(container)).toBe("150");
});

const rows: TokensByProjectRow[] = [
  { projectId: "p1", projectName: "Alpha", input: 100, output: 50, cache: 10, sessions: 3, byProfile: { work: bucket(100, 50, 10) } },
  { projectId: null, projectName: "unassigned", input: 5, output: 0, cache: 0, sessions: 1, byProfile: { personal: bucket(5) } },
];

test("TokensByProjectChart counts only the accounts it was given", () => {
  const data: TokensByProjectRow[] = [
    { projectId: "p1", projectName: "Alpha", input: 150, output: 0, cache: 0, sessions: 2, byProfile: { work: bucket(100), personal: bucket(50) } },
  ];
  const both = render(() => <TokensByProjectChart data={data} profiles={["work", "personal"]} />);
  expect(both.container.querySelector(".tbp-total")!.textContent).toBe("150");

  const workOnly = render(() => <TokensByProjectChart data={data} profiles={["work"]} />);
  expect(workOnly.container.querySelector(".tbp-total")!.textContent).toBe("100");
});

test("TokensByProjectChart stacks the account and token-type filters", () => {
  const data: TokensByProjectRow[] = [
    { projectId: "p1", projectName: "Alpha", input: 150, output: 0, cache: 40, sessions: 2, byProfile: { work: bucket(100, 0, 30), personal: bucket(50, 0, 10) } },
  ];
  const { container } = render(() => (
    <TokensByProjectChart data={data} profiles={["work"]} series={{ input: true, output: true, cache: false }} />
  ));
  expect(container.querySelector(".tbp-total")!.textContent).toBe("100");
});

test("TokensByProjectChart falls back to the flat totals when given no account list", () => {
  const data: TokensByProjectRow[] = [
    { projectId: "p1", projectName: "Alpha", input: 150, output: 0, cache: 0, sessions: 2, byProfile: { work: bucket(100), personal: bucket(50) } },
  ];
  const { container } = render(() => <TokensByProjectChart data={data} />);
  expect(container.querySelector(".tbp-total")!.textContent).toBe("150");
});

test("TokensByProjectChart renders one row per project", () => {
  const { container } = render(() => <TokensByProjectChart data={rows} />);
  expect(container.querySelectorAll(".tbp-row")).toHaveLength(2);
  expect(container.textContent).toContain("Alpha");
  expect(container.textContent).toContain("unassigned");
});

test("TokensByProjectChart calls onSelectProject with the project id when a row is clicked", () => {
  let picked: string | null | undefined;
  const { container } = render(() => (
    <TokensByProjectChart data={rows} onSelectProject={(id) => (picked = id)} />
  ));
  (container.querySelector(".tbp-row") as HTMLElement).click();
  expect(picked).toBe("p1");
});

test("TokensByProjectChart renders an empty-state when there is no data", () => {
  const { container } = render(() => <TokensByProjectChart data={[]} />);
  expect(container.textContent).toContain("no data");
});

test("TokensByProjectChart series mask: hiding cache shows input+output total only", () => {
  const data: TokensByProjectRow[] = [
    { projectId: "p1", projectName: "Alpha", input: 100, output: 50, cache: 10, sessions: 1, byProfile: { work: bucket(100, 50, 10) } },
  ];
  const { container } = render(() => (
    <TokensByProjectChart data={data} series={{ input: true, output: true, cache: false }} />
  ));
  expect(container.querySelector(".tbp-total")!.textContent).toBe("150");
  expect(container.textContent).not.toContain("160");
});

const profileRows = [
  { profile: "work", input: 1000, output: 0, cache: 0, sessions: 2 },
  { profile: "unassigned", input: 5, output: 0, cache: 0, sessions: 1 },
];

test("TokensByProfileChart renders one row per profile and fires onSelectProfile", () => {
  let picked: string | undefined;
  const { container } = render(() => (
    <TokensByProfileChart data={profileRows} onSelectProfile={(p) => (picked = p)} />
  ));
  expect(container.querySelectorAll(".tbp-row")).toHaveLength(2);
  expect(container.textContent).toContain("work");
  expect(container.textContent).toContain("unassigned");
  (container.querySelector(".tbp-row") as HTMLElement).click();
  expect(picked).toBe("work");
});

test("TokensByProfileChart renders an empty-state when there is no data", () => {
  const { container } = render(() => <TokensByProfileChart data={[]} />);
  expect(container.textContent).toContain("no data");
});
