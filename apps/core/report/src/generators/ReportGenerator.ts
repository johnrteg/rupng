//
import type { Type } from "@repo/common";

//
// ReportGenerator — the contract every report's generator implements (report-9.1's "generator factory, by
// report type"). A generator pulls its rows from the OWNING service's internal S2S API (never a peer's
// DB — report-11.2) and returns them as a flat, format-agnostic table (`rows` + `columns`) for a `Writer`
// to render into the requested output format.
//
export interface ReportGenerator
{
    /** Produce this report's rows for one submission. Never throws — a data-source failure is a
     *  `Type.Result` err, which the caller turns into a `Submission.error` (report-6.1). */
    generate( ctx : ReportGenerator.GenerateContext ) : Promise<Type.Result<ReportGenerator.GenerateResult>>;
}

export namespace ReportGenerator
{
    /** Everything one generation run needs — the resolved (already-computed) window, when the report is
     *  time-bounded, plus the raw validated `params` for any report-specific extras (e.g. a `status` filter). */
    export interface GenerateContext
    {
        accountId : Type.ID;
        window?   : { start : string; end : string };
        params    : Type.Json;
    }

    /** A flat, renderer-agnostic table — `columns` fixes the column order every `Writer` renders in;
     *  `rows` are plain objects keyed by column name (missing keys render blank). */
    export interface GenerateResult
    {
        rows    : Array<Record<string, unknown>>;
        columns : Array<string>;
    }
}

export default ReportGenerator;
// eof
