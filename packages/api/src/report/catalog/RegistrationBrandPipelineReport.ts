//
// RegistrationBrandPipelineReport — the catalog entry for the "TCR brand pipeline" report. USER-gated; one
// row per brand with its pipeline status/vetting facts plus a per-status campaign-count rollup (computed by
// the generator from the account's campaigns). Params are the shared base only (no extra filter).
//
import { Access } from "@repo/endpoint";
import { Report } from "../model/Report";
import { REPORT_BASE_PARAMS_SCHEMA } from "./ReportBaseParams";

export const RegistrationBrandPipelineReport : Report.Definition =
{
    reportId:     "registration_brand_pipeline",
    name:         "Registration Brand Pipeline",
    minAccess:    Access.AccountRole.USER,
    generator:    "registration_brand_pipeline",
    paramsSchema: { ...REPORT_BASE_PARAMS_SCHEMA },
    specVersion:  1,
    formats:      [ "csv", "xlsx", "json" ],
    description:  "TCR brands with pipeline status, vetting facts, and campaign counts by status.",
    tags:         [ "registration" ],
};

export default RegistrationBrandPipelineReport;
// eof
