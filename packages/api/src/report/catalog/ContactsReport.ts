//
// ContactsReport — the catalog entry for the "all contacts + current status" report. USER-gated (a normal
// account user may run it); adds an optional `status` filter on top of the shared base params.
//
import { Access } from "@repo/endpoint";
import type { Type } from "@repo/common";
import { Report } from "../model/Report";
import { REPORT_BASE_PARAMS_SCHEMA } from "./ReportBaseParams";

export const ContactsReport : Report.Definition =
{
    reportId:     "contacts",
    name:         "Contacts",
    minAccess:    Access.AccountRole.USER,
    generator:    "contacts",
    paramsSchema:
    {
        ...REPORT_BASE_PARAMS_SCHEMA,
        properties:
        {
            ...( REPORT_BASE_PARAMS_SCHEMA.properties as Type.JsonObject ),
            status: { type: "string", description: "Optional contact-status filter." },
        },
    },
    specVersion:  1,
    formats:      [ "csv", "xlsx", "json" ],
    description:  "All contacts with their current status.",
    tags:         [ "contacts" ],
};

export default ContactsReport;
// eof
