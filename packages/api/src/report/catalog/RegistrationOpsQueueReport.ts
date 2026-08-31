//
// RegistrationOpsQueueReport — the catalog entry for the staff "registration ops queue" report: brands and
// campaigns currently sitting in a non-terminal "needs attention" status (IN_REVIEW / NEEDS_APPEAL / REJECTED
// for brands; IN_REVIEW / REJECTED for campaigns), with time-in-status, so staff can triage stuck rows.
//
// Staff-only, NOT a normal account-user report — but `Report.Definition.minAccess` (packages/api/src/report/
// model/Report.ts) is typed strictly as `Access.AccountRole`, not the combined `Access.Role` union, so an
// `AppRole` (e.g. `Access.AppRole.SUPPORT` — the floor of the staff ladder, `SUPPORT < APPLICATION < ROOT`;
// this is a routine triage view any support agent should reach, not something that needs the more senior
// tiers) literally cannot be assigned here. FINDING: the catalog model has no way to declare a staff-only
// minimum today. Using the highest `AccountRole` (`ACCOUNT`) as the closest available floor; the REAL
// staff-only gate must be enforced in the generator/endpoint layer (checking the caller's `Access.Role`
// against at least `Access.AppRole.SUPPORT` before running this report), not by this `minAccess` value alone.
//
import { Access } from "@repo/endpoint";
import { Report } from "../model/Report";
import { REPORT_BASE_PARAMS_SCHEMA } from "./ReportBaseParams";

export const RegistrationOpsQueueReport : Report.Definition =
{
    reportId:     "registration_ops_queue",
    name:         "Registration Ops Queue",
    minAccess:    Access.AccountRole.ACCOUNT,   // closest available floor — see FINDING above; real gate is staff-only
    generator:    "registration_ops_queue",
    paramsSchema: { ...REPORT_BASE_PARAMS_SCHEMA },
    specVersion:  1,
    formats:      [ "csv", "xlsx", "json" ],
    description:  "STAFF ONLY — brands/campaigns needing attention (in-review, needs-appeal, rejected), with time-in-status.",
    tags:         [ "registration", "ops" ],
};

export default RegistrationOpsQueueReport;
// eof
