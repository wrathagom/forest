import { render, fireEvent } from "@solidjs/testing-library";
import { describe, expect, test, beforeEach } from "vitest";
import DashboardToolbar from "../src/components/DashboardToolbar";
import { THEME_BY_ID } from "../src/lib/themes/index";
import { setDashboardColorBy, setDashboardPreset } from "../src/lib/preferences";

const theme = THEME_BY_ID["forest-dark"]!;

// persistedSignal creates module-level singletons that read localStorage once at
// import time, so clearing storage would NOT reset them. Reset via the setters
// instead, or these tests leak state into each other in file order.
beforeEach(() => {
  setDashboardPreset("status");
  setDashboardColorBy("git");
});

function setup(groups: string[] = []) {
  const utils = render(() => (
    <DashboardToolbar query="" onQuery={() => {}} groups={groups} theme={theme} />
  ));
  const legendLabels = () =>
    [...utils.container.querySelectorAll(".legend-entry")].map((e) => e.textContent);
  const pickColorBy = (v: string) => {
    const select = utils.container.querySelector(".colorby-select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: v } });
  };
  return { ...utils, legendLabels, pickColorBy };
}

describe("DashboardToolbar", () => {
  test("renders one button per view preset", () => {
    const { getByRole } = setup();
    for (const p of ["compact", "status", "detail"]) {
      expect(getByRole("button", { name: p })).toBeTruthy();
    }
  });

  test("marks exactly one preset active, defaulting to status", () => {
    const { container } = setup();
    const active = container.querySelectorAll(".preset-btn.active");
    expect(active).toHaveLength(1);
    expect(active[0]!.textContent).toBe("status");
  });

  test("switching preset moves the active marker", () => {
    const { container, getByRole } = setup();
    fireEvent.click(getByRole("button", { name: "compact" }));
    const active = container.querySelectorAll(".preset-btn.active");
    expect(active).toHaveLength(1);
    expect(active[0]!.textContent).toBe("compact");
  });

  test("offers all seven color-by dimensions in order", () => {
    const { container } = setup();
    const opts = [...container.querySelectorAll(".colorby-select option")]
      .map((o) => o.getAttribute("value"));
    expect(opts).toEqual(["git", "heat", "services", "agents", "lifecycle", "group", "none"]);
  });

  test("renders the git legend by default", () => {
    expect(setup().legendLabels()).toEqual(["clean", "dirty", "error", "none"]);
  });

  test("the legend follows the selected dimension", () => {
    const { legendLabels, pickColorBy } = setup();
    pickColorBy("heat");
    expect(legendLabels()).toEqual(["today", "week", "month", "quarter", "older"]);
  });

  test("the group legend lists real groups plus ungrouped", () => {
    const { legendLabels, pickColorBy } = setup(["Personal", "Work"]);
    pickColorBy("group");
    expect(legendLabels()).toEqual(["Personal", "Work", "ungrouped"]);
  });

  test("none shows no legend entries", () => {
    const { legendLabels, pickColorBy } = setup();
    pickColorBy("none");
    expect(legendLabels()).toEqual([]);
  });

  test("typing in the search box reports upward", () => {
    let seen = "";
    const { container } = render(() => (
      <DashboardToolbar query="" onQuery={(q) => (seen = q)} groups={[]} theme={theme} />
    ));
    fireEvent.input(container.querySelector(".search-input") as HTMLInputElement, {
      target: { value: "forest" },
    });
    expect(seen).toBe("forest");
  });
});
