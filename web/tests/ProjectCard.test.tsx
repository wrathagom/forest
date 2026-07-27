import { render, screen, fireEvent, waitFor } from "@solidjs/testing-library";
import { describe, expect, test } from "vitest";
import { MemoryRouter as Router, Route, useParams } from "@solidjs/router";
import ProjectCard from "../src/components/ProjectCard";
import type { ProjectRow } from "../src/api";
import { THEME_BY_ID } from "../src/lib/themes/index";

const k = THEME_BY_ID["forest-dark"]!.tokens;

const base: ProjectRow = {
  id: "abc", name: "demo", path: "/p", pinned: false, hidden: false, group: null,
  scannedAt: Date.now(), liveSessions: 0, liveAgents: [],
  snapshot: {
    git: { branch: "main", dirty: false, changed: 0, ahead: 0, behind: 0, lastCommit: null },
    lastEdit: Date.now(), services: { docker: [], processes: [] }, errors: [],
  },
};

// A sentinel on the detail route lets navigation tests assert on the actual
// routed outcome (a real route change) rather than on whether a handler ran.
function DetailSentinel() {
  const params = useParams();
  return <div data-testid="detail-sentinel">{params.id}</div>;
}

function renderCard(project: ProjectRow, over: { preset?: any; colorBy?: any; groups?: string[] } = {}) {
  return render(() => (
    <Router>
      <Route path="/" component={() => (
        <ProjectCard
          project={project}
          preset={over.preset ?? "status"}
          colorBy={over.colorBy ?? "git"}
          groups={over.groups ?? []}
          onChange={() => {}}
        />
      )} />
      <Route path="/projects/:id" component={DetailSentinel} />
    </Router>
  ));
}

const band = (c: HTMLElement) => c.querySelector(".card-band") as HTMLElement;

describe("ProjectCard — band", () => {
  test("renders the name in the band", () => {
    renderCard(base);
    expect(screen.getByText("demo")).toBeTruthy();
  });

  test("has no status dot and no pin star", () => {
    const { container } = renderCard({ ...base, pinned: true });
    expect(container.querySelector(".dot")).toBeNull();
    expect(container.querySelector(".pin")).toBeNull();
  });

  test("colors the band ok when clean and error when errors exist", () => {
    const clean = renderCard(base);
    expect(band(clean.container).style.getPropertyValue("--k")).toBe(k.ok);
    expect(band(clean.container).classList.contains("neutral")).toBe(false);
    clean.unmount();

    const bad = renderCard({ ...base, snapshot: { ...base.snapshot!, errors: ["docker unreachable"] } });
    expect(band(bad.container).style.getPropertyValue("--k")).toBe(k.error);
  });

  test("sets a derived band foreground alongside the background", () => {
    const { container } = renderCard(base);
    expect(band(container).style.getPropertyValue("--kfg")).toMatch(/^#[0-9a-f]{6}$/i);
  });

  test("renders the group tag, and the archived tag only when hidden", () => {
    const a = renderCard({ ...base, group: "Personal" });
    expect(a.getByText("Personal")).toBeTruthy();
    expect(a.queryByText("archived")).toBeNull();
    a.unmount();

    const b = renderCard({ ...base, hidden: true });
    expect(b.getByText("archived")).toBeTruthy();
  });

  test("always renders the actions menu trigger", () => {
    const { container } = renderCard(base);
    expect(container.querySelector(".card-menu-trigger")).toBeTruthy();
  });

  test("keeps the right-cluster order fixed: archived tag, group tag, then the menu — so the ☰ never shifts", () => {
    const { container } = renderCard({ ...base, hidden: true, group: "Personal" });
    const right = container.querySelector(".card-band-right") as HTMLElement;
    const kids = Array.from(right.children);
    expect(kids).toHaveLength(3);
    expect(kids[0]?.textContent).toBe("archived");
    expect(kids[0]?.className).toContain("archived");
    expect(kids[1]?.textContent).toBe("Personal");
    expect(kids[1]?.className).not.toContain("archived");
    expect(kids[2]?.querySelector(".card-menu-trigger")).toBeTruthy();
  });
});

describe("ProjectCard — status preset", () => {
  test("shows the branch and the dirty count", () => {
    renderCard({ ...base, snapshot: { ...base.snapshot!, git: { ...base.snapshot!.git, dirty: true, changed: 4 } } });
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getByText("+4")).toBeTruthy();
  });

  test("emits no clean chip and no 'no services' fallback", () => {
    const { container } = renderCard(base);
    expect(container.textContent).not.toContain("clean");
    expect(container.textContent).not.toContain("no services");
  });

  test("renders each distinct port as its own chip", () => {
    renderCard({ ...base, snapshot: { ...base.snapshot!, services: { docker: [], processes: [
      { pid: 100, command: "vite", cwd: "/p", ports: [5173, 3000] },
      { pid: 200, command: "bun", cwd: "/p", ports: [52810] },
    ] } } });
    expect(screen.getByText(":3000")).toBeTruthy();
    expect(screen.getByText(":5173")).toBeTruthy();
    expect(screen.getByText(":52810")).toBeTruthy();
  });

  test("renders terminals and agent chips", () => {
    const { container } = renderCard({ ...base, liveSessions: 2, liveAgents: [{ agent: "claude", count: 2 }] });
    expect(container.textContent).toContain("2 terminals");
    expect(container.textContent).toContain("🤖 2");
  });

  test("lists errors", () => {
    renderCard({ ...base, snapshot: { ...base.snapshot!, errors: ["docker: docker unreachable"] } });
    expect(screen.getByText("docker: docker unreachable")).toBeTruthy();
  });

  test("the chip row is the last thing in the body, so margin-top:auto can float it", () => {
    // vitest's jsdom does not load styles.css and does no layout, so neither
    // the computed margin nor the resulting height is observable here. What IS
    // observable — and what the CSS depends on — is that the chip row is the
    // final child of the flex column. The pixel geometry is verified in the
    // browser in Task 10 Step 4.
    const { container } = renderCard({
      ...base,
      snapshot: { ...base.snapshot!, errors: ["docker unreachable"] },
    });
    const body = container.querySelector(".card-body") as HTMLElement;
    expect(body.lastElementChild?.className).toContain("card-chips");
  });
});

describe("ProjectCard — other presets", () => {
  test("compact renders one summary line and no chips", () => {
    const { container } = renderCard(base, { preset: "compact" });
    expect(container.querySelector(".card-chips")).toBeNull();
    expect(container.textContent).toContain("main · clean");
  });

  test("detail renders labelled rows including the commit message", () => {
    const { container } = renderCard({
      ...base,
      snapshot: { ...base.snapshot!, git: { ...base.snapshot!.git,
        lastCommit: { sha: "a", message: "fix: a thing", timestamp: Date.now() - 3_600_000 } } },
    }, { preset: "detail" });
    expect(container.textContent).toContain("commit");
    expect(container.textContent).toContain("fix: a thing");
  });

  test("clamps only the commit row to two lines", () => {
    const { container } = renderCard({
      ...base,
      snapshot: { ...base.snapshot!, git: { ...base.snapshot!.git,
        lastCommit: { sha: "a", message: "fix: a thing", timestamp: Date.now() - 3_600_000 } } },
    }, { preset: "detail" });
    const clamped = container.querySelector(".card-rows dd.clamp-2");
    expect(clamped?.textContent).toContain("fix: a thing");

    const dds = Array.from(container.querySelectorAll(".card-rows dd"));
    const nonCommitDds = dds.filter((d) => d !== clamped);
    expect(nonCommitDds.length).toBeGreaterThan(0);
    for (const d of nonCommitDds) expect(d.className).not.toContain("clamp-2");
  });
});

describe("ProjectCard — no snapshot", () => {
  test("says it has not been scanned and stays on a neutral band", () => {
    const { container } = renderCard({ ...base, snapshot: null });
    expect(container.textContent).toContain("not scanned yet");
    expect(band(container).style.getPropertyValue("--k")).toBe(k.bg3);
    expect(band(container).classList.contains("neutral")).toBe(true);
  });
});

// MemoryRouter resolves a navigation asynchronously (the affirmative test
// below needs `waitFor` to observe it), so a synchronous check right after
// `fireEvent.click` in the negative tests would trivially pass whether or not
// the guard worked — it just wouldn't have happened *yet* either way. Flush
// the same async window before asserting absence, so a broken guard is
// actually caught.
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("ProjectCard — navigation", () => {
  test("clicking the card body navigates to the project detail route", async () => {
    const { container, queryByTestId } = renderCard(base);
    fireEvent.click(container.querySelector(".card-body") as HTMLElement);
    await waitFor(() => expect(queryByTestId("detail-sentinel")?.textContent).toBe("abc"));
  });

  test("clicking the menu trigger does not navigate", async () => {
    const { container, queryByTestId } = renderCard(base);
    fireEvent.click(container.querySelector(".card-menu-trigger") as HTMLElement);
    await flush();
    expect(queryByTestId("detail-sentinel")).toBeNull();
  });

  test("clicking the popover's own padding (not a button) does not navigate", async () => {
    const { container, queryByTestId } = renderCard(base);
    fireEvent.click(container.querySelector(".card-menu-trigger") as HTMLElement); // open
    fireEvent.click(container.querySelector(".card-menu-popover") as HTMLElement);
    await flush();
    expect(queryByTestId("detail-sentinel")).toBeNull();
  });

  test("clicking the menu's rule divider does not navigate", async () => {
    const { container, queryByTestId } = renderCard(base);
    fireEvent.click(container.querySelector(".card-menu-trigger") as HTMLElement); // open
    fireEvent.click(container.querySelector(".card-menu-rule") as HTMLElement);
    await flush();
    expect(queryByTestId("detail-sentinel")).toBeNull();
  });
});
