import { describe, expect, test } from "bun:test";
import { openDb } from "../src/store/db";
import {
  upsertProject,
  updateProject,
  listProjects,
  listVisibleProjects,
  hashPath,
} from "../src/store/projects";

function seed() {
  const db = openDb(":memory:");
  upsertProject(db, { path: "/a", name: "alpha" });
  upsertProject(db, { path: "/b", name: "beta" });
  upsertProject(db, { path: "/c", name: "charlie" });
  updateProject(db, hashPath("/b"), { pinned: true });
  updateProject(db, hashPath("/c"), { hidden: true });
  return db;
}

describe("listProjects view selector", () => {
  test("default view excludes hidden, pinned-first then name", () => {
    const db = seed();
    expect(listProjects(db, "default").map((p) => p.name)).toEqual(["beta", "alpha"]);
  });

  test("archived view returns only hidden projects", () => {
    const db = seed();
    expect(listProjects(db, "archived").map((p) => p.name)).toEqual(["charlie"]);
  });

  test("all view returns every project, pinned-first then name", () => {
    const db = seed();
    expect(listProjects(db, "all").map((p) => p.name)).toEqual(["beta", "alpha", "charlie"]);
  });

  test("listVisibleProjects stays equivalent to the default view", () => {
    const db = seed();
    expect(listVisibleProjects(db).map((p) => p.name)).toEqual(
      listProjects(db, "default").map((p) => p.name),
    );
  });
});
