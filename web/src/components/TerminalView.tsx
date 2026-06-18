import { onCleanup, onMount } from "solid-js";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";

type ServerFrame =
  | { type: "scrollback"; data: string }
  | { type: "output"; data: string }
  | { type: "exit"; code: number | null }
  | { type: "error"; message: string }
  | { type: "pong" };

export default function TerminalView(props: {
  projectId: string;
  sessionId: string;
  visible: boolean;
  onExit?: (code: number | null) => void;
}) {
  let host!: HTMLDivElement;
  let term: Terminal | null = null;
  let fit: FitAddon | null = null;
  let webgl: WebglAddon | null = null;
  let ws: WebSocket | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  // Set once the session has exited — stop sending input/resize frames to a
  // pty whose fd is already closed (they'd surface EBADF on the server).
  let dead = false;

  const disposeWebgl = () => {
    try {
      webgl?.dispose();
    } catch {
      // already disposed or context lost
    }
    webgl = null;
  };

  const sendResize = () => {
    if (dead || !term || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
  };

  onMount(async () => {
    // xterm.js measures the font in a canvas at terminal-open time. If the
    // browser hasn't loaded the font yet, the measurement uses the fallback
    // and Nerd Font glyphs never render even after the family becomes
    // available. Force a synchronous load before constructing.
    if (typeof document !== "undefined" && document.fonts && document.fonts.load) {
      try {
        await Promise.all([
          document.fonts.load('13px "FiraCode Nerd Font Mono"'),
          document.fonts.load('bold 13px "FiraCode Nerd Font Mono"'),
        ]);
      } catch {
        // ignore — fall back to the family list
      }
    }

    term = new Terminal({
      // Prefer the *Mono* variant: it forces every icon glyph to the same
      // cell width terminals expect. The non-Mono variant has variable-width
      // icons that render but throw off cell math and may render some PUA
      // glyphs as fallback characters.
      fontFamily: '"FiraCode Nerd Font Mono", "FiraCode Nerd Font", ui-monospace, Menlo, monospace',
      fontSize: 13,
      theme: {
        background: "#0e0e10",
        foreground: "#e6e6e6",
        cursor: "#6ee7b7",
      },
      // xterm parses OSC 8 hyperlink escapes and applies link styling
      // regardless, but the click handler only runs if linkHandler is set.
      // Without this, CLIs that emit OSC 8 (claude, gh, eza, fd, ...) render
      // styled links that do nothing on click.
      linkHandler: {
        activate: (_event, uri) => {
          window.open(uri, "_blank", "noopener,noreferrer");
        },
      },
      allowProposedApi: true,
      convertEol: false,
      scrollback: 5000,
    });
    fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(host);

    // WebGL renderer must load after term.open(); it builds its glyph atlas
    // from the live DOM. WebGL handles in-place row redraws (Ink-style status
    // updates, spinners) more cleanly than the canvas renderer — fewer ghost
    // glyphs in scrollback. The browser caps live WebGL contexts (~16 in
    // Chrome), so disposing in onCleanup and on context-loss is critical.
    try {
      const addon = new WebglAddon();
      addon.onContextLoss(disposeWebgl);
      term.loadAddon(addon);
      webgl = addon;
    } catch {
      // GPU unavailable / disabled — fall back to canvas renderer silently
      webgl = null;
    }

    fit.fit();

    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(
      `${proto}://${location.host}/ws/projects/${encodeURIComponent(props.projectId)}/sessions/${encodeURIComponent(props.sessionId)}`,
    );

    ws.onopen = () => {
      sendResize();
    };
    ws.onmessage = (ev) => {
      let frame: ServerFrame;
      try {
        frame = JSON.parse(String(ev.data)) as ServerFrame;
      } catch {
        return;
      }
      if (!term) return;
      if (frame.type === "scrollback" || frame.type === "output") {
        term.write(frame.data);
      } else if (frame.type === "exit") {
        dead = true;
        term.write(`\r\n[exited with code ${frame.code ?? "?"}]\r\n`);
        props.onExit?.(frame.code);
      } else if (frame.type === "error") {
        term.write(`\r\n[error: ${frame.message}]\r\n`);
      }
    };

    term.onData((data) => {
      if (dead || !ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "input", data }));
    });

    // Shift+Enter → ESC+CR. xterm.js maps both Enter and Shift+Enter to a plain
    // CR by default; ESC+CR is what Claude Code and readline-style programs
    // recognize as "insert literal newline" instead of "submit". xterm processes
    // Enter via both keydown and keypress, so we must suppress both — but only
    // emit our ESC+CR once (on keydown).
    term.attachCustomKeyEventHandler((e) => {
      if (e.key === "Enter" && e.shiftKey) {
        if (e.type === "keydown" && ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "input", data: "\x1b\r" }));
        }
        return false;
      }
      return true;
    });

    const ro = new ResizeObserver(() => {
      try {
        fit?.fit();
        sendResize();
      } catch {
        // host detached during transition
      }
    });
    ro.observe(host);

    pingTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
    }, 30_000);

    onCleanup(() => {
      ro.disconnect();
      if (pingTimer) clearInterval(pingTimer);
      if (ws && ws.readyState !== WebSocket.CLOSED) {
        try { ws.close(1000); } catch { /* ignore */ }
      }
      // Dispose WebGL before term.dispose() so the GL context is released
      // back to the browser's pool — without this, repeated tab open/close
      // cycles eventually trip Chrome's "too many WebGL contexts" cap.
      disposeWebgl();
      term?.dispose();
      term = null;
      fit = null;
      ws = null;
    });
  });

  return (
    <div
      ref={host!}
      class={`terminal-host ${props.visible ? "visible" : "hidden"}`}
      style={{
        visibility: props.visible ? "visible" : "hidden",
        "pointer-events": props.visible ? "auto" : "none",
      }}
    />
  );
}
