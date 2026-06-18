import { createResource, createSignal, Show } from "solid-js";
import { fetchBbsConfig, saveBbsConfig, provisionBbs, testBbs } from "../api";

export default function BbsSettings() {
  const [cfg, { refetch }] = createResource(fetchBbsConfig);
  const [accountKey, setAccountKey] = createSignal("");
  const [baseUrl, setBaseUrl] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [msg, setMsg] = createSignal<string | null>(null);
  const [err, setErr] = createSignal<string | null>(null);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setErr(null); setMsg(null);
    try { await fn(); setMsg(ok); await refetch(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const saveKey = () =>
    run(async () => {
      const k = accountKey().trim();
      if (!k) return;
      await saveBbsConfig({ accountKey: k });
      setAccountKey("");
    }, "Saved account key");

  const saveUrl = (current: string) =>
    run(async () => {
      await saveBbsConfig({ baseUrl: (baseUrl() ?? current).trim() });
      setBaseUrl(null);
    }, "Saved base URL");

  const toggleEnabled = (v: boolean) => run(() => saveBbsConfig({ enabled: v }), v ? "Enabled" : "Disabled");

  return (
    <section style={{ "margin-top": "1.5rem" }}>
      <h2>Big Beautiful Screens</h2>
      <Show when={cfg()} fallback={<p>Loading…</p>}>
        {(c) => (
          <div style={{ display: "flex", "flex-direction": "column", gap: "0.6rem", "max-width": "40rem" }}>
            <label style={{ display: "flex", gap: "0.5rem", "align-items": "center" }}>
              <input type="checkbox" checked={c().enabled} disabled={busy()} onChange={(e) => toggleEnabled(e.currentTarget.checked)} />
              Send Forest session HUD to a BBS screen
            </label>

            <label>
              Account key (<code>ak_…</code>){c().accountKey ? ` — saved (${c().accountKey})` : ""}
              <div style={{ display: "flex", gap: "0.4rem" }}>
                <input type="password" placeholder="ak_…" value={accountKey()} onInput={(e) => setAccountKey(e.currentTarget.value)} style={{ flex: 1 }} />
                <button disabled={busy() || !accountKey().trim()} onClick={saveKey}>Save</button>
              </div>
            </label>

            <label>
              BBS server URL
              <div style={{ display: "flex", gap: "0.4rem" }}>
                <input
                  type="text"
                  placeholder="https://app.bigbeautifulscreens.com"
                  value={baseUrl() ?? c().baseUrl}
                  onInput={(e) => setBaseUrl(e.currentTarget.value)}
                  style={{ flex: 1 }}
                />
                <button disabled={busy()} onClick={() => saveUrl(c().baseUrl)}>Save URL</button>
              </div>
            </label>

            <div style={{ display: "flex", gap: "0.4rem", "align-items": "center", "flex-wrap": "wrap" }}>
              <button disabled={busy() || !c().accountKey} onClick={() => run(provisionBbs, "Screen provisioned")}>
                {c().screenId ? "Re-check / repair screen" : "Provision screen"}
              </button>
              <button disabled={busy() || !c().screenId} onClick={() => run(testBbs, "Test alert sent")}>Send test alert</button>
              <Show when={c().screenUrl}>
                <a href={c().screenUrl!} target="_blank" rel="noreferrer">Open screen ↗</a>
              </Show>
            </div>

            <Show when={c().status.lastError}>
              <p style={{ color: "#c0392b" }}>Last publish error: {c().status.lastError}</p>
            </Show>
            <Show when={msg()}><p style={{ color: "#2e7d32" }}>{msg()}</p></Show>
            <Show when={err()}><p style={{ color: "#c0392b" }}>{err()}</p></Show>
          </div>
        )}
      </Show>
    </section>
  );
}
