import { render, screen, fireEvent } from "@solidjs/testing-library";
import { describe, expect, test, vi } from "vitest";
import NewProjectModal from "../src/components/NewProjectModal";
import type { ProjectRow } from "../src/api";

const fakeProject: ProjectRow = {
  id: "abc",
  name: "demo",
  path: "/p",
  pinned: false,
  hidden: false,
  group: null,
  liveSessions: 0,
  scannedAt: null,
  snapshot: null,
};

function fakeApi(success = true, errorMessage = "boom") {
  return vi.fn(async (body: { name: string; subdir: string; source: { type: "blank" } | { type: "clone"; url: string } }) => {
    void body;
    if (!success) throw new Error(errorMessage);
    return { project: fakeProject };
  });
}

describe("NewProjectModal", () => {
  test("renders form fields", () => {
    render(() => (
      <NewProjectModal
        subdirs={["Personal", "Professional"]}
        api={fakeApi()}
        onCreated={() => {}}
        onClose={() => {}}
      />
    ));
    expect(screen.getByPlaceholderText(/project name/i)).toBeTruthy();
    expect(screen.getByText("create")).toBeTruthy();
  });

  test("blocks submit when name is invalid", async () => {
    const api = fakeApi();
    render(() => (
      <NewProjectModal
        subdirs={[]}
        api={api}
        onCreated={() => {}}
        onClose={() => {}}
      />
    ));
    const nameInput = screen.getByPlaceholderText(/project name/i) as HTMLInputElement;
    fireEvent.input(nameInput, { target: { value: "../bad" } });
    fireEvent.click(screen.getByText("create"));
    await new Promise((r) => setTimeout(r, 10));
    expect(api).not.toHaveBeenCalled();
    expect(screen.getByText(/letters, digits/i)).toBeTruthy();
  });

  test("submits a blank project with the chosen subdir", async () => {
    const api = fakeApi();
    const onCreated = vi.fn();
    render(() => (
      <NewProjectModal
        subdirs={["Personal", "Professional"]}
        api={api}
        onCreated={onCreated}
        onClose={() => {}}
      />
    ));
    fireEvent.input(screen.getByPlaceholderText(/project name/i), { target: { value: "demo" } });
    fireEvent.change(screen.getByLabelText(/sub-dir/i), { target: { value: "Personal" } });
    fireEvent.click(screen.getByText("create"));
    await new Promise((r) => setTimeout(r, 30));
    expect(api).toHaveBeenCalledWith({
      name: "demo",
      subdir: "Personal",
      source: { type: "blank" },
    });
    expect(onCreated).toHaveBeenCalledWith(fakeProject);
  });

  test("submits a clone with the entered URL", async () => {
    const api = fakeApi();
    render(() => (
      <NewProjectModal
        subdirs={[]}
        api={api}
        onCreated={() => {}}
        onClose={() => {}}
      />
    ));
    fireEvent.input(screen.getByPlaceholderText(/project name/i), { target: { value: "cloned" } });
    fireEvent.click(screen.getByLabelText(/clone from URL/i));
    fireEvent.input(screen.getByPlaceholderText(/clone url/i), {
      target: { value: "git@github.com:foo/bar.git" },
    });
    fireEvent.click(screen.getByText("create"));
    await new Promise((r) => setTimeout(r, 30));
    expect(api).toHaveBeenCalledWith({
      name: "cloned",
      subdir: "",
      source: { type: "clone", url: "git@github.com:foo/bar.git" },
    });
  });

  test("shows server error inline and stays open", async () => {
    const api = fakeApi(false, "destination already exists: /x/y");
    const onCreated = vi.fn();
    render(() => (
      <NewProjectModal
        subdirs={[]}
        api={api}
        onCreated={onCreated}
        onClose={() => {}}
      />
    ));
    fireEvent.input(screen.getByPlaceholderText(/project name/i), { target: { value: "demo" } });
    fireEvent.click(screen.getByText("create"));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByText(/destination already exists/i)).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
