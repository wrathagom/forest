// server/tests/lifecycle-store.test.ts
import { describe, expect, test } from "bun:test";
import { openDb } from "../src/store/db";
import { upsertProject, getProjectById, updateProject } from "../src/store/projects";

describe("lifecycleEnabled", () => {
  test("defaults to false and toggles via updateProject", () => {
    const db = openDb(":memory:");
    const id = upsertProject(db, { path: "/tmp/proj", name: "proj" });
    expect(getProjectById(db, id)!.lifecycleEnabled).toBe(false);

    updateProject(db, id, { lifecycleEnabled: true });
    expect(getProjectById(db, id)!.lifecycleEnabled).toBe(true);

    updateProject(db, id, { lifecycleEnabled: false });
    expect(getProjectById(db, id)!.lifecycleEnabled).toBe(false);
  });
});
