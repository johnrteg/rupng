//
// RegistrationChargesReport — the catalog entry for the "TCR cost estimates" report. USER-gated; one row per
// cost-estimate ledger row. IMPORTANT: these are ESTIMATES only — `Registration.CostEstimate` is a stub ledger
// (no billing engine exists yet anywhere in the platform), so this report renders "what WOULD be billed" at
// each legacy TCR charge point, never an actual charge. Params are the shared base only (no extra filter).
//
import { Access } from "@repo/endpoint";
import { Report } from "../model/Report";
import { REPORT_BASE_PARAMS_SCHEMA } from "./ReportBaseParams";

export const RegistrationChargesReport : Report.Definition =
{
    reportId:     "registration_cost_estimates",
    name:         "Registration Cost Estimates",
    minAccess:    Access.AccountRole.USER,
    generator:    "registration_cost_estimates",
    paramsSchema: { ...REPORT_BASE_PARAMS_SCHEMA },
    specVersion:  1,
    formats:      [ "csv", "xlsx", "json" ],
    description:  "ESTIMATED TCR registration/vetting/monthly charges (not actual charges — no billing engine exists yet).",
    tags:         [ "registration", "billing" ],
};

export default RegistrationChargesReport;
// eof
