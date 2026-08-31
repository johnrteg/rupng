//
// ReportCatalog — the platform's full CODE-defined report registry (report-1.1/1.3): one universal, global
// list, shared with the client at build time. The dashboard filters by `minAccess` locally; the server
// re-checks it on submit. Adding a report is adding an entry here (+ its generator implementation).
//
import type { Type }   from "@repo/common";
import type { Report } from "../model/Report";
import { ContactsReport } from "./ContactsReport";
import { AccountsReport } from "./AccountsReport";
import { CampaignsReport } from "./CampaignsReport";

export const REPORT_CATALOG : Array<Report.Definition> = [ ContactsReport, AccountsReport, CampaignsReport ];

/** Look up one catalog entry by its stable `reportId` (undefined if unknown). */
export function findReport( reportId : Type.ID ) : Report.Definition | undefined
{
    return REPORT_CATALOG.find( ( report : Report.Definition ) : boolean => report.reportId === reportId );
}

// eof
