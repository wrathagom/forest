import { createResource, createSignal, For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { fetchConfig, patchConfig, runDiscover } from "../api";
import { useProjects } from "../projects-context";
import { autoRefresh, setAutoRefresh } from "../lib/preferences";
import BbsSettings from "../components/BbsSettings";

type LauncherEntry = {
  id: string;
  label: string;
  command: string | null;
  args: string[];
  agent?: string;
};

export default function Settings() {
  const [cfg] = createResource(fetchConfig);
  const { refetch: refetchProjects } = useProjects();
  const nav = useNavigate();
  const [scanRoot, setScanRoot] = createSignal("");
  const [pollMs, setPollMs] = createSignal(10_000);
  const [maxTotal, setMaxTotal] = createSignal(32);
  const [maxScrollback, setMaxScrollback] = createSignal(10000);
  const [shell, setShell] = createSignal("");
  const [subdirs, setSubdirs] = createSignal<string[]>([]);
  const [newSubdir, setNewSubdir] = createSignal("");
  const [subdirError, setSubdirError] = createSignal<string | null>(null);
  const [launchers, setLaunchers] = createSignal<LauncherEntry[]>([]);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal<string | null>(null);

  const init = (c: {
    scanRoot: string | null;
    pollIntervalMs: number;
    sessionMaxTotal?: number;
    sessionMaxScrollbackLines?: number;
    sessionDefaultShell?: string;
    projectSubdirs?: string[];
    launchers?: LauncherEntry[];
    claudeConfigDirs?: Array<{ path: string; profile: string }>;
  }) => {
    if (scanRoot() === "") setScanRoot(c.scanRoot ?? "");
    if (pollMs() === 10_000) setPollMs(c.pollIntervalMs);
    if (typeof c.sessionMaxTotal === "number") setMaxTotal(c.sessionMaxTotal);
    if (typeof c.sessionMaxScrollbackLines === "number") setMaxScrollback(c.sessionMaxScrollbackLines);
    if (typeof c.sessionDefaultShell === "string" && shell() === "") setShell(c.sessionDefaultShell);
    if (Array.isArray(c.projectSubdirs) && subdirs().length === 0) setSubdirs(c.projectSubdirs);
    if (Array.isArray(c.launchers) && launchers().length === 0) setLaunchers(c.launchers);
  };

  const onSave = async (e: Event) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      await patchConfig({
        scanRoot: scanRoot(),
        pollIntervalMs: pollMs(),
        sessionMaxTotal: maxTotal(),
        sessionMaxScrollbackLines: maxScrollback(),
        sessionDefaultShell: shell(),
        projectSubdirs: subdirs(),
        launchers: launchers(),
      });
      const result = await runDiscover();
      await refetchProjects();
      setStatus(`discovered ${result.count ?? 0} repos under ${result.root ?? scanRoot()}`);
      setTimeout(() => nav("/"), 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const isValidSubdir = (value: string): boolean => {
    if (value.length === 0) return false;
    const parts = value.split("/");
    return parts.every(
      (p) => p.length > 0 && p !== "." && p !== ".." && /^[A-Za-z0-9._-]+$/.test(p),
    );
  };

  const addSubdir = () => {
    const value = newSubdir().trim();
    if (!value) return;
    if (!isValidSubdir(value)) {
      setSubdirError("letters, digits, . _ - per segment, separated by /");
      return;
    }
    if (subdirs().includes(value)) {
      setSubdirError("already in the list");
      return;
    }
    setSubdirs([...subdirs(), value]);
    setNewSubdir("");
    setSubdirError(null);
  };
  const removeSubdir = (s: string) => setSubdirs(subdirs().filter((x) => x !== s));

  const addLauncher = () =>
    setLaunchers((arr) => [...arr, { id: `custom-${Date.now()}`, label: "new", command: null, args: [] }]);

  const removeLauncher = (i: number) =>
    setLaunchers((arr) => arr.filter((_, j) => j !== i));

  const updateLauncher = (i: number, patch: Partial<LauncherEntry>) =>
    setLaunchers((arr) => arr.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const moveLauncher = (i: number, dir: -1 | 1) => {
    const arr = launchers();
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    const next = [...arr];
    [next[i], next[j]] = [next[j], next[i]];
    setLaunchers(next);
  };

  return (
    <div class="settings">
      <h2>settings</h2>
      <Show when={cfg()}>{(c) => { init(c()); return null; }}</Show>
      <form onsubmit={onSave}>
        <fieldset>
          <legend>dashboard</legend>
          <label class="checkbox-row">
            <input
              type="checkbox"
              checked={autoRefresh()}
              onchange={(e) => setAutoRefresh(e.currentTarget.checked)}
            />
            auto-refresh dashboard every 5s
          </label>
        </fieldset>
        <fieldset>
          <legend>scan</legend>
          <label>
            scan root
            <input type="text" placeholder="~/Projects" value={scanRoot()} oninput={(e) => setScanRoot(e.currentTarget.value)} />
            <span class="hint">absolute path or `~/...`. must exist.</span>
          </label>
          <label>
            poll interval (ms)
            <input type="number" min={1000} step={1000} value={pollMs()} oninput={(e) => setPollMs(parseInt(e.currentTarget.value, 10))} />
          </label>
        </fieldset>
        <fieldset>
          <legend>project sub-dirs</legend>
          <div class="subdir-chips">
            <For each={subdirs()}>
              {(s) => (
                <span class="subdir-chip">
                  {s}
                  <button type="button" onclick={() => removeSubdir(s)} title="remove">×</button>
                </span>
              )}
            </For>
            <Show when={subdirs().length === 0}>
              <span class="muted">no sub-dirs configured — projects land directly under the scan root</span>
            </Show>
          </div>
          <div class="subdir-add-row">
            <input
              type="text"
              placeholder="add sub-dir (e.g. Personal or Professional/Customers)"
              value={newSubdir()}
              oninput={(e) => setNewSubdir(e.currentTarget.value)}
              onkeydown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSubdir(); } }}
            />
            <button type="button" onclick={addSubdir}>+ add</button>
          </div>
          <Show when={subdirError()}>
            <span class="hint" style={{ color: "var(--error)" }}>{subdirError()}</span>
          </Show>
        </fieldset>
        <fieldset>
          <legend>terminals</legend>
          <label>
            max total sessions
            <input type="number" min={1} step={1} value={maxTotal()} oninput={(e) => setMaxTotal(parseInt(e.currentTarget.value, 10))} />
          </label>
          <label>
            max scrollback lines
            <input type="number" min={100} step={100} value={maxScrollback()} oninput={(e) => setMaxScrollback(parseInt(e.currentTarget.value, 10))} />
          </label>
          <label>
            default shell
            <input type="text" placeholder="$SHELL" value={shell()} oninput={(e) => setShell(e.currentTarget.value)} />
            <span class="hint">leave blank to use $SHELL or /bin/bash.</span>
          </label>
        </fieldset>
        <fieldset>
          <legend>launchers</legend>
          <span class="hint">entries available from the new-terminal split button</span>
          <Show when={launchers().length > 0}>
            <div class="launcher-list">
              <For each={launchers()}>
                {(l, i) => (
                  <div class="launcher-row">
                    <div class="launcher-reorder">
                      <button
                        type="button"
                        class="launcher-move"
                        disabled={i() === 0}
                        onclick={() => moveLauncher(i(), -1)}
                        title="move up"
                      >▲</button>
                      <button
                        type="button"
                        class="launcher-move"
                        disabled={i() === launchers().length - 1}
                        onclick={() => moveLauncher(i(), 1)}
                        title="move down"
                      >▼</button>
                    </div>
                    <div class="launcher-fields">
                      <label class="launcher-field-label">
                        label
                        <input
                          type="text"
                          value={l.label}
                          oninput={(e) => updateLauncher(i(), { label: e.currentTarget.value })}
                        />
                      </label>
                      <label class="launcher-field-label">
                        command
                        <input
                          type="text"
                          value={l.command ?? ""}
                          placeholder="blank = default shell"
                          oninput={(e) => updateLauncher(i(), { command: e.currentTarget.value || null })}
                        />
                      </label>
                      <label class="launcher-field-label">
                        args
                        <input
                          type="text"
                          value={l.args.join(" ")}
                          placeholder="space-separated"
                          oninput={(e) =>
                            updateLauncher(i(), { args: e.currentTarget.value.split(/\s+/).filter(Boolean) })
                          }
                        />
                      </label>
                      <label class="launcher-field-label">
                        agent tag
                        <input
                          type="text"
                          value={l.agent ?? ""}
                          placeholder="e.g. claude"
                          oninput={(e) =>
                            updateLauncher(i(), { agent: e.currentTarget.value || undefined })
                          }
                        />
                      </label>
                    </div>
                    <button
                      type="button"
                      class="launcher-remove"
                      onclick={() => removeLauncher(i())}
                      title="remove"
                    >×</button>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <Show when={launchers().length === 0}>
            <div class="muted" style={{ padding: "0.3rem 0" }}>no launchers configured</div>
          </Show>
          <div class="settings-row" style={{ "margin-top": "0.4rem" }}>
            <button type="button" onclick={addLauncher}>+ add launcher</button>
          </div>
        </fieldset>
        <div class="settings-row">
          <button type="submit" disabled={saving()}>{saving() ? "saving…" : "save"}</button>
          <button type="button" disabled={saving()} onclick={() => nav("/")}>cancel</button>
        </div>
        <Show when={error()}>
          <div class="banner banner-error">{error()}</div>
        </Show>
        <Show when={status() && !error()}>
          <div class="banner banner-ok">{status()}</div>
        </Show>
      </form>
      <Show when={cfg()?.claudeConfigDirs?.length}>
        <section class="settings-section">
          <h3>claude config dirs</h3>
          <span class="hint">detected automatically — Forest scans transcripts and installs hooks into each</span>
          <ul class="config-dirs-list">
            <For each={cfg()!.claudeConfigDirs!}>
              {(d) => (
                <li><span class="config-dir-profile">{d.profile}</span> <code>{d.path}</code></li>
              )}
            </For>
          </ul>
        </section>
      </Show>
      <BbsSettings />
    </div>
  );
}
