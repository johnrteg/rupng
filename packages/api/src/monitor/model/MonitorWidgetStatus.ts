//
// MonitorWidgetStatus — the live read for one configured MonitorConfig.WidgetConfig: a single
// primary value (queue depth, table item count, running task count, …) plus a derived status
// color from the widget's configured thresholds, and a small bag of secondary values for the
// tile's detail view. Deliberately flat/generic across widget types — v1 has no per-type stored
// history, just "what does the source say right now."
//
export namespace MonitorWidgetStatus
{
    /** Derived from the widget's `thresholds` (or `OK` when none are configured / the read failed open). */
    export enum Level { OK = "ok", WARN = "warn", CRITICAL = "critical", ERROR = "error" }

    export interface Data
    {
        widgetId       : string;
        level          : Level;
        primaryValue?  : number;             // the tile's headline number (depth, item count, running count, …)
        primaryLabel?  : string;             // what primaryValue means (e.g. "messages", "running tasks")
        details        : Record<string, number | string>;   // secondary fields for the tile's detail view
        error?         : string;             // set when the source read failed (level is ERROR in that case)
        polledAt       : string;             // ISO timestamp of this read
    }
}

export default MonitorWidgetStatus;
// eof
