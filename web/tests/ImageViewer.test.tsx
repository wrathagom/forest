import { render, screen, fireEvent } from "@solidjs/testing-library";
import { describe, expect, test } from "vitest";
import ImageViewer from "../src/components/ImageViewer";

function renderViewer() {
  return render(() => (
    <ImageViewer projectId="abc" path="/img/pic.png" mtimeMs={123} />
  ));
}

describe("ImageViewer", () => {
  test("renders at fit: 100% readout and scale(1)", () => {
    const { container } = renderViewer();
    expect(screen.getByText("100%")).toBeTruthy();
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.style.transform).toContain("scale(1)");
  });

  test("zoom-in button steps to 125% and scale(1.25)", () => {
    const { container } = renderViewer();
    fireEvent.click(screen.getByLabelText("zoom in"));
    expect(screen.getByText("125%")).toBeTruthy();
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.style.transform).toContain("scale(1.25)");
  });

  test("zoom-out is disabled at fit", () => {
    renderViewer();
    expect((screen.getByLabelText("zoom out") as HTMLButtonElement).disabled).toBe(true);
  });

  test("fit button resets zoom back to 100%", () => {
    renderViewer();
    fireEvent.click(screen.getByLabelText("zoom in"));
    fireEvent.click(screen.getByLabelText("zoom in"));
    expect(screen.getByText("156%")).toBeTruthy();
    fireEvent.click(screen.getByText("fit"));
    expect(screen.getByText("100%")).toBeTruthy();
  });
});
