//
import type { Type } from "@repo/common";
import type { Report } from "@repo/api";

//
// Destination — the contract every delivery-intent handler implements (report-7.x). Report itself never
// "ships" a report to a durable channel/connector (that's workflow-driven, off `report.completed`) — these
// handlers only cover what report DOES do directly on completion: making the artifact downloadable (no-op),
// emailing a simple completion notice, or POSTing a webhook notification. Anything richer (SFTP, Drive,
// CRM, per-account provider failover) lives in the workflow + channel/dispatch layer, per SPECS.md.
//
export interface Destination
{
    /** Deliver (or no-op, for DOWNLOAD) the completion notice for one finished submission. Never throws —
     *  a delivery failure is logged by the caller, never fails the underlying generation. */
    deliver( ctx : Destination.DeliverContext ) : Promise<Type.Result<void>>;
}

export namespace Destination
{
    export interface DeliverContext
    {
        accountId   : Type.ID;
        submission  : Report.Submission;
        /** The ONE destination this call delivers to — `deliverCompletion` fans out over
         *  `submission.destinations` and invokes a handler once per entry, so a handler only ever sees a
         *  single resolved `Destination` here, never the full array. */
        destination : Report.Destination;
        downloadUrl : string;
    }
}

export default Destination;
// eof
