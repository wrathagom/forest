import type { SessionRegistry } from "./registry";
import type { AttachData, ClientFrame, ServerFrame } from "./types";

interface AttachWs {
  data: AttachData;
  send: (s: string) => void;
  close: (code?: number) => void;
}

function send(ws: AttachWs, frame: ServerFrame): void {
  ws.send(JSON.stringify(frame));
}

export function attach(ws: AttachWs, registry: SessionRegistry): void {
  const session = registry.get(ws.data.sessionId);
  if (!session) {
    send(ws, { type: "error", message: "unknown session" });
    ws.close(4404);
    return;
  }
  registry.flushPending(session.id);  // drain coalesce buffer before replaying scrollback
  session.attachments.add(ws);
  send(ws, { type: "scrollback", data: session.scrollback.toString() });
}

export function handleClientFrame(ws: AttachWs, raw: string, registry: SessionRegistry): void {
  const session = registry.get(ws.data.sessionId);
  if (!session) return;
  let frame: ClientFrame;
  try {
    frame = JSON.parse(raw) as ClientFrame;
  } catch {
    return;
  }
  switch (frame.type) {
    case "input":
      // The pty's fd may have just closed (child exited, session in its
      // post-exit retention window). A failed write here is expected, not fatal.
      try { session.pty.write(frame.data); } catch { /* pty closed */ }
      return;
    case "resize":
      try { session.pty.resize(frame.cols, frame.rows); } catch { /* pty closed */ }
      return;
    case "ping":
      send(ws, { type: "pong" });
      return;
    default:
      return;
  }
}

export function detach(ws: AttachWs, registry: SessionRegistry): void {
  const session = registry.get(ws.data.sessionId);
  if (!session) return;
  session.attachments.delete(ws);
}
