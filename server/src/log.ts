export type Level = "info" | "warn" | "error";

export function makeLogger(): (level: Level, msg: string, meta?: Record<string, unknown>) => void {
  return (level, msg, meta) => {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(meta ?? {}) });
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  };
}
