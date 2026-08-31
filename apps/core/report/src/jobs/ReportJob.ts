//
import { Application, Job, Register } from "@repo/services";

import ReportService from "../services/ReportService";

//
// ReportJob — the report domain's Job BASE (mirrors `SocialJob`'s shape on the queue/event side, as
// `ReportService` does on the HTTP side). Composes a bare `ReportService` instance (constructed, never
// `.run()` — so no HTTP server binds; only its facades + business methods are used) so
// `ReportGenerateJob`/`ReportScheduleJob` call the EXACT SAME `processSubmission` pipeline
// `ReportMainService`'s local queue drain calls — there is exactly ONE code path for generation, per
// SPECS.md's Service & Job topology. (The alternative — re-deriving the domain logic directly on the Job
// base — would fork that pipeline; composition keeps it singular.)
//
export abstract class ReportJob<TEvent = unknown, TResult = void> extends Job<TEvent, TResult>
{
    /** The composed domain service — facades + `processSubmission`/schedule methods, never run as a server. */
    protected readonly report : ReportService = new ReportService( ReportService.Role.MAIN );

    ///////////////////////////////////////////////////////////////////////////////////////
    constructor( name : string )
    {
        super( Register.Service.REPORT, name );
        const pkg : Application.PackageInfo = this.loadPackageInfo( __dirname );
        this.log.info( "version", { name: pkg.name, version: pkg.version } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Parse the `{ accountId, submissionId }` refs out of an SQS Lambda event's records. */
    protected submissionRefs( event : unknown ) : Array<{ accountId : string; submissionId : string }>
    {
        const records : Array<{ body? : string }> = ( event as { Records? : Array<{ body? : string }> } )?.Records ?? [];
        const refs : Array<{ accountId : string; submissionId : string }> = [];
        for( const record of records )
        {
            try
            {
                const parsed : { accountId? : string; submissionId? : string } = JSON.parse( record.body ?? "{}" );
                if( parsed.accountId && parsed.submissionId ) refs.push( { accountId: parsed.accountId, submissionId: parsed.submissionId } );
            }
            catch { /* skip a malformed record */ }
        }
        return refs;
    }
}

export default ReportJob;
// eof
