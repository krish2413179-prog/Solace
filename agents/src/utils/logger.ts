import { config } from "../config.js";

type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const configured = LEVELS[(config.LOG_LEVEL as Level) ?? "info"] ?? 1;

function log(level: Level, name: string, msg: string) {
  if (LEVELS[level] < configured) return;
  const ts = new Date().toISOString().replace("T", " ").substring(0, 19);
  const pad = name.padEnd(28);
  console.log(`${ts} | ${level.toUpperCase().padEnd(5)} | ${pad} | ${msg}`);
}

export function getLogger(name: string) {
  return {
    debug: (msg: string) => log("debug", name, msg),
    info:  (msg: string) => log("info",  name, msg),
    warn:  (msg: string) => log("warn",  name, msg),
    error: (msg: string) => log("error", name, msg),
  };
}
