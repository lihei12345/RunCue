type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "\x1b[90m",  // gray
  info: "\x1b[36m",   // cyan
  warn: "\x1b[33m",   // yellow
  error: "\x1b[31m",  // red
};
const RESET = "\x1b[0m";

export interface Logger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

let globalVerbose = false;
let stderrOnly = false;

export function setVerbose(verbose: boolean): void {
  globalVerbose = verbose;
}

/** Force all log output to stderr (required for MCP stdio transport — stdout is reserved for JSON-RPC). */
export function setStderrOnly(enabled: boolean): void {
  stderrOnly = enabled;
}

export function createLogger(scope: string): Logger {
  const log = (level: LogLevel, msg: string) => {
    if (level === "debug" && !globalVerbose) return;
    const color = LEVEL_COLORS[level];
    const prefix = `${color}[${scope}]${RESET}`;
    // In MCP mode, ALL output must go to stderr to avoid corrupting the JSON-RPC stream on stdout.
    const fn = stderrOnly ? console.error
      : level === "error" ? console.error
      : level === "warn" ? console.warn
      : console.log;
    fn(`${prefix} ${msg}`);
  };

  return {
    debug: (msg) => log("debug", msg),
    info: (msg) => log("info", msg),
    warn: (msg) => log("warn", msg),
    error: (msg) => log("error", msg),
  };
}
