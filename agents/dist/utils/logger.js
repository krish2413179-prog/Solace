import { config } from "../config.js";
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const configured = LEVELS[config.LOG_LEVEL ?? "info"] ?? 1;
function log(level, name, msg) {
    if (LEVELS[level] < configured)
        return;
    const ts = new Date().toISOString().replace("T", " ").substring(0, 19);
    const pad = name.padEnd(28);
    console.log(`${ts} | ${level.toUpperCase().padEnd(5)} | ${pad} | ${msg}`);
}
export function getLogger(name) {
    return {
        debug: (msg) => log("debug", name, msg),
        info: (msg) => log("info", name, msg),
        warn: (msg) => log("warn", name, msg),
        error: (msg) => log("error", name, msg),
    };
}
//# sourceMappingURL=logger.js.map