import { describe, expect, test } from "bun:test";
import { probeProcessDetail, _internal } from "../src/scanner/processes";

describe("probeProcessDetail", () => {
  test("maps ps + lsof output, filters to inside-cwd, sorts by pid", async () => {
    const probe = probeProcessDetail({
      runDetail: async () => ({
        psDetail:
          "  100  10 alice  3.4 145408 Mon May  8 14:30:00 2026 /usr/local/bin/bun run dev\n" +
          "  200  10 alice  0.1  18432 Mon May  8 14:31:00 2026 node esbuild\n" +
          "  300  10 alice  0.0   4096 Mon May  8 14:32:00 2026 bash\n",
        cwdRaw: "p100\nn/proj/sub\np200\nn/elsewhere\np300\nn/proj\n",
        portsRaw: "p100\nn*:5173\n",
      }),
    });
    const out = await probe("/proj");
    expect(out.map((p) => p.pid)).toEqual([100, 300]);
    expect(out[0]!.cpu).toBe(3.4);
    expect(out[0]!.memMB).toBe(142);
    expect(out[0]!.cwd).toBe("/proj/sub");
    expect(out[0]!.ports).toEqual([5173]);
    expect(out[1]!.command).toBe("bash");
    expect(out[1]!.ports).toEqual([]);
  });

  test("startedAt parses lstart to ms epoch", async () => {
    const probe = probeProcessDetail({
      runDetail: async () => ({
        psDetail: "  42  1 alice  0.0   1000 Mon May  8 14:30:00 2026 /bin/sleep\n",
        cwdRaw: "p42\nn/proj\n",
        portsRaw: "",
      }),
    });
    const out = await probe("/proj");
    expect(typeof out[0]!.startedAt).toBe("number");
    expect(out[0]!.startedAt).toBeGreaterThan(0);
  });

  test("excludes processes without a resolvable cwd", async () => {
    const probe = probeProcessDetail({
      runDetail: async () => ({
        psDetail: "  99  1 alice  0.0  1024 Mon May  8 14:30:00 2026 ghost\n",
        cwdRaw: "",
        portsRaw: "",
      }),
    });
    const out = await probe("/proj");
    expect(out).toEqual([]);
  });

  test("parsePsDetail extracts every column", () => {
    const out = "  100  10 alice  3.4 145408 Mon May  8 14:30:00 2026 /usr/local/bin/bun run dev";
    const [row] = _internal.parsePsDetail(out);
    expect(row).toBeDefined();
    expect(row!.pid).toBe(100);
    expect(row!.ppid).toBe(10);
    expect(row!.user).toBe("alice");
    expect(row!.cpu).toBe(3.4);
    expect(row!.memKB).toBe(145408);
    expect(row!.lstart).toBe("Mon May  8 14:30:00 2026");
    expect(row!.command).toBe("/usr/local/bin/bun run dev");
  });
});
