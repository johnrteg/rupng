//
// ReportBaseParams — the shared ajv schema FRAGMENT every report's `paramsSchema` spreads/extends
// (report-3.1). Today it carries just the `window` (`Report.DateWindow`) param — the one shared shape
// nearly every time-bounded report needs — but is the natural home for any future common param (e.g. a
// shared `format`/locale knob) that isn't report-specific. A generator consumes the resolved value via the
// plain `ReportBaseParams` TS type rather than re-declaring the shape at each call site.
//
import type { Type }   from "@repo/common";
import type { Report } from "../model/Report";

// The ajv `oneOf` over the three DateWindow variants — mirrors `Report.DateWindow`'s tagged union exactly.
const DATE_WINDOW_SCHEMA : Type.JsonObject =
{
    type: "object",
    oneOf:
    [
        {
            type: "object", additionalProperties: false, required: [ "kind" ],
            properties: { kind: { const: "fixed" }, start: { type: "string", format: "date-time" }, end: { type: "string", format: "date-time" } },
        },
        {
            type: "object", additionalProperties: false, required: [ "kind", "preset" ],
            properties: { kind: { const: "relative" }, preset: { type: "string" } },
        },
        {
            type: "object", additionalProperties: false, required: [ "kind", "rolling" ],
            properties:
            {
                kind: { const: "relative" },
                rolling: { type: "object", additionalProperties: false, required: [ "amount", "unit" ],
                           properties: { amount: { type: "number", minimum: 1 }, unit: { type: "string" } } },
                endOffsetDays: { type: "number", minimum: 0 },
            },
        },
    ],
};

/** The base `paramsSchema` fragment — every catalog `Definition.paramsSchema` spreads this in and adds its
 *  own report-specific properties on top (still `required: ["window"]` unless a report is explicitly
 *  window-less). */
export const REPORT_BASE_PARAMS_SCHEMA : Type.JsonObject =
{
    type: "object",
    required: [ "window" ],
    properties:
    {
        window: DATE_WINDOW_SCHEMA,
    },
};

/** The plain TS shape a generator consumes once params have validated against a schema built on
 *  `REPORT_BASE_PARAMS_SCHEMA` — every time-bounded report's generator narrows its own params to at least
 *  this much. */
export interface ReportBaseParams
{
    window : Report.DateWindow;
}

// eof
