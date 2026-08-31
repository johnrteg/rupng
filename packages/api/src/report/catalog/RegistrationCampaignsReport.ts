//
// RegistrationCampaignsReport — the catalog entry for the "TCR campaigns" report. USER-gated; adds an
// optional `status` filter on top of the shared base params (same pattern as `CampaignsReport`).
//
import { Access } from "@repo/endpoint";
import type { Type } from "@repo/common";
import { Report } from "../model/Report";
import { REPORT_BASE_PARAMS_SCHEMA } from "./ReportBaseParams";

export const RegistrationCampaignsReport : Report.Definition =
{
    reportId:     "registration_campaigns",
    name:         "Registration Campaigns",
    minAccess:    Access.AccountRole.USER,
    generator:    "registration_campaigns",
    paramsSchema:
    {
        ...REPORT_BASE_PARAMS_SCHEMA,
        properties:
        {
            ...( REPORT_BASE_PARAMS_SCHEMA.properties as Type.JsonObject ),
            status: { type: "string", description: "Optional campaign-status filter." },
        },
    },
    specVersion:  1,
    formats:      [ "csv", "xlsx", "pdf", "json" ],
    description:  "TCR campaigns with usecase, provider, status, and phone-number counts.",
    tags:         [ "registration" ],
};

export default RegistrationCampaignsReport;
// eof
