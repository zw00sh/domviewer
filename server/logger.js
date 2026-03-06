/**
 * Minimal server-side logger with LOG_LEVEL filtering.
 * Reads LOG_LEVEL from env (default: "info"). Valid levels: debug, info, warn, error.
 *
 * All storeLog calls in state.js route through here so every DB-persisted event
 * also appears on stdout, filtered by the configured level.
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

const rawLevel = (process.env.LOG_LEVEL || "info").toLowerCase();
const minLevel = LEVELS[rawLevel] ?? LEVELS.info;

const consoleFns = {
  debug: console.debug,
  info: console.info,
  warn: console.warn,
  error: console.error,
};

/**
 * Returns true if the given level should be printed given the current LOG_LEVEL setting.
 * @param {string} level
 */
export function shouldLog(level) {
  return (LEVELS[level] ?? LEVELS.info) >= minLevel;
}

/**
 * Print a structured log line to stdout.
 * Format: `2026-01-01T00:00:00.000Z [LEVEL] [source] message`
 * @param {string} level - "debug" | "info" | "warn" | "error"
 * @param {string} source - Short source tag (e.g. "server", "c2", "spider")
 * @param {string} message
 */
export function log(level, source, message) {
  if (!shouldLog(level)) return;
  const ts = new Date().toISOString();
  const levelTag = level.toUpperCase().padEnd(5);
  (consoleFns[level] ?? console.log)(`${ts} [${levelTag}] [${source}] ${message}`);
}

export const debug = (source, message) => log("debug", source, message);
export const info  = (source, message) => log("info",  source, message);
export const warn  = (source, message) => log("warn",  source, message);
export const error = (source, message) => log("error", source, message);
