import { test, expect } from "vitest";
import { render } from "@solidjs/testing-library";
import MonitorPanel from "../src/components/MonitorPanel";

test("renders both Processes and Containers section headers", () => {
  const { container } = render(() => (
    <MonitorPanel projectId="p1" enabled={() => true} />
  ));
  expect(container.textContent).toContain("Processes");
  expect(container.textContent).toContain("Containers");
});
