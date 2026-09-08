var Logger = class Logger {
  constructor(prefix = "Research Link Manager") {
    this.prefix = prefix;
    this.recentErrors = [];
  }

  info(message, context) {
    Zotero.debug(this._format("INFO", message, context));
  }

  warn(message, context) {
    Zotero.debug(this._format("WARN", message, context), 2);
  }

  error(message, error, context) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error || "");
    const formatted = this._format("ERROR", `${message}${detail ? `: ${detail}` : ""}`, context);
    this.recentErrors.push({ time: new Date().toISOString(), message: formatted });
    this.recentErrors = this.recentErrors.slice(-50);
    Zotero.logError(new Error(formatted));
  }

  _format(level, message, context) {
    const suffix = context && Object.keys(context).length
      ? ` ${JSON.stringify(context)}`
      : "";
    return `[${this.prefix}] [${level}] ${message}${suffix}`;
  }
};
