import { render, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, test, vi, afterEach } from "vitest";
import BbsSettings from "../src/components/BbsSettings";

const fetchBbsConfig = vi.fn();
const saveBbsConfig = vi.fn();
const provisionBbs = vi.fn();
const testBbs = vi.fn();

vi.mock("../src/api", () => ({
  fetchBbsConfig: (...a: unknown[]) => fetchBbsConfig(...a),
  saveBbsConfig: (...a: unknown[]) => saveBbsConfig(...a),
  provisionBbs: (...a: unknown[]) => provisionBbs(...a),
  testBbs: (...a: unknown[]) => testBbs(...a),
}));

const cfg = {
  enabled: false,
  baseUrl: "https://app.bigbeautifulscreens.com",
  screenId: null,
  screenUrl: null,
  accountKey: null,
  screenKey: null,
  alertLingerSec: 60,
  hudIntervalMs: 30000,
  rotationIntervalSec: 8,
  hudPanelCap: 6,
  alertEvents: ["waiting", "stop"],
  status: { lastOk: null, lastError: null },
};

afterEach(() => {
  fetchBbsConfig.mockReset();
  saveBbsConfig.mockReset();
});

describe("BbsSettings base URL", () => {
  test("renders the configured base URL in an input", async () => {
    fetchBbsConfig.mockResolvedValue(cfg);
    render(() => <BbsSettings />);
    await waitFor(() =>
      expect(screen.getByDisplayValue("https://app.bigbeautifulscreens.com")).toBeTruthy(),
    );
  });

  test("editing and saving the base URL calls saveBbsConfig with the new baseUrl", async () => {
    fetchBbsConfig.mockResolvedValue(cfg);
    saveBbsConfig.mockResolvedValue({ ok: true });
    render(() => <BbsSettings />);
    const input = await waitFor(() =>
      screen.getByDisplayValue("https://app.bigbeautifulscreens.com"),
    );
    fireEvent.input(input, { target: { value: "https://bbs.internal.example" } });
    fireEvent.click(screen.getByText("Save URL"));
    await waitFor(() =>
      expect(saveBbsConfig).toHaveBeenCalledWith({ baseUrl: "https://bbs.internal.example" }),
    );
  });
});
