//
// AccountsReport — the catalog entry for the "managed sub-accounts" report. ACCOUNT-gated — sub-account
// visibility is a higher bar than the default USER floor. Params are the shared base only (no extra filter).
//
import { Access } from "@repo/endpoint";
import { Report } from "../model/Report";
import { REPORT_BASE_PARAMS_SCHEMA } from "./ReportBaseParams";

export const AccountsReport : Report.Definition =
{
    reportId:     "account_lists",
    name:         "Account Lists",
    minAccess:    Access.AccountRole.ACCOUNT,
    generator:    "accounts",
    paramsSchema: { ...REPORT_BASE_PARAMS_SCHEMA },
    specVersion:  1,
    formats:      [ "csv", "xlsx", "json" ],
    description:  "Managed sub-accounts.",
};

export default AccountsReport;
// eof
