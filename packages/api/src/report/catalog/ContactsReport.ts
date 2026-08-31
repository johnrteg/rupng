//
// ContactsReport — the catalog entry for the "contact list" report. USER-gated (a normal account user may
// run it). The shared base `window` param filters by `Contact.audit.createdAt` (creation date range —
// fixed for a one-time run, relative for a schedule); on top of that this report adds its own
// contact-specific filters: a `modifiedStart`/`modifiedEnd` range (`Contact.audit.modifiedAt`, always
// fixed — a schedule only needs the primary `window` to be relative, per report-3.3), an optional
// `segmentId` (contact <-> segment membership), an optional `status` filter, and optional `tags`.
//
import { Access } from "@repo/endpoint";
import type { Type } from "@repo/common";
import { Report } from "../model/Report";
import { REPORT_BASE_PARAMS_SCHEMA } from "./ReportBaseParams";

export const ContactsReport : Report.Definition =
{
    reportId:     "contact_lists",
    name:         "Contact Lists",
    minAccess:    Access.AccountRole.USER,
    generator:    "contacts",
    paramsSchema:
    {
        ...REPORT_BASE_PARAMS_SCHEMA,
        properties:
        {
            ...( REPORT_BASE_PARAMS_SCHEMA.properties as Type.JsonObject ),
            status:        { type: "string", description: "Optional contact-status filter." },
            modifiedStart: { type: "string", format: "date-time", description: "Optional last-modified range start." },
            modifiedEnd:   { type: "string", format: "date-time", description: "Optional last-modified range end." },
            segmentId:     { type: "string", description: "Optional segment membership filter." },
            tags:          { type: "array", items: { type: "string" }, description: "Optional tag filter (any match)." },
        },
    },
    specVersion:  1,
    formats:      [ "csv", "xlsx", "json" ],
    description:  "Contacts (creation/modified date range, segment, tags, status).",
    tags:         [ "contacts" ],
};

export default ContactsReport;
// eof
