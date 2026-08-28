//
// LogLevel — the wire-level closed set for a service's configurable minimum log verbosity, read from its
// `config/settings` AppConfig profile's optional `logLevel` field. Mirrors @repo/common's `Trace.Level`
// names/semantics (parsed by `Trace.parseLevel`) but as a STRING enum (`Trace.Level` is numeric) so it's
// JSON-Schema-friendly and Console-editable. Any Config model that wants dynamic (no-redeploy) log-level
// control adds this field — see CLAUDE.md "Architecture & boundaries" for how the read side applies it.
//
export enum LogLevel
{
    TRACE   = "trace",
    INFO    = "info",
    WARNING = "warn",
    ERROR   = "error",
}

export default LogLevel;
