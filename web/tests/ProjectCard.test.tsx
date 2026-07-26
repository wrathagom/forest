import { render, screen } from "@solidjs/testing-library";
import { describe, expect, test } from "vitest";
import { Router, Route } from "@solidjs/router";
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
});

describe("ProjectCard — no snapshot", () => {
  test("says it has not been scanned and stays on a neutral band", () => {
    const { container } = renderCard({ ...base, snapshot: null });
    expect(container.textContent).toContain("not scanned yet");
    expect(band(container).style.getPropertyValue("--k")).toBe(k.bg3);
  });
});
