//
// CampaignsReport — the catalog entry for the "campaigns + performance summary" report. USER-gated; adds an
// optional `status` filter on top of the shared base params.
//
import { Access } from "@repo/endpoint";
import type { Type } from "@repo/common";
import { Report } from "../model/Report";
import { REPORT_BASE_PARAMS_SCHEMA } from "./ReportBaseParams";

export const CampaignsReport : Report.Definition =
{
    reportId:     "campaign_lists",
    name:         "Campaign Lists",
    minAccess:    Access.AccountRole.USER,
    generator:    "campaigns",
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
    description:  "Campaigns with performance summary.",
    tags:         [ "campaigns" ],
};

export default CampaignsReport;
// eof
