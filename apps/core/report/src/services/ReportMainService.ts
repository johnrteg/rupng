//
import { RequestContext, Sqs } from "@repo/services";
import type { Type } from "@repo/common";
import type { Message } from "@aws-sdk/client-sqs";

import ReportService from "./ReportService";

import PostReportRunsImpl from "../endpoints/PostReportRunsImpl";
import GetReportSubmissionsImpl from "../endpoints/GetReportSubmissionsImpl";
import GetReportSubmissionImpl from "../endpoints/GetReportSubmissionImpl";
import GetReportSubmissionDownloadImpl from "../endpoints/GetReportSubmissionDownloadImpl";
import DeleteReportSubmissionImpl from "../endpoints/DeleteReportSubmissionImpl";
import GetReportSchedulesImpl from "../endpoints/GetReportSchedulesImpl";
import GetReportScheduleImpl from "../endpoints/GetReportScheduleImpl";
import PatchReportScheduleImpl from "../endpoints/PatchReportScheduleImpl";
import PostReportSchedulePauseImpl from "../endpoints/PostReportSchedulePauseImpl";
import PostReportScheduleResumeImpl from "../endpoints/PostReportScheduleResumeImpl";
import DeleteReportScheduleImpl from "../endpoints/DeleteReportScheduleImpl";
import GetReportSchedulesStaleImpl from "../endpoints/GetReportSchedulesStaleImpl";
import PostReportInternalEraseImpl from "../endpoints/PostReportInternalEraseImpl";
import GetReportConfigImpl from "../endpoints/GetReportConfigImpl";
import PutReportConfigImpl from "../endpoints/PutReportConfigImpl";

//
// MAIN role — the /report/* API (catalog is code-defined + client-shipped, so there's no catalog route
// here — submit/status/schedule mgmt/download/config/health only). Also DRAINS the report-generate queue
// in-process (so generation works end-to-end without a separate Job runtime locally) AND runs the
// `WorkQueue` dispatch loop that releases governed submissions onto that queue. In a deploy,
// `ReportGenerateJob` / `ReportScheduleJob` Lambdas own the queue/sweep (same `ReportService` code) and MAIN
// is just the API. Same shape as apps/core/voice/src/services/VoiceMainService.ts.
//
export class ReportMainService extends ReportService
{
    private stopping : boolean = false;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( ReportService.Role.MAIN );
        void this.startGenerateConsumer();
        void this.startDispatchLoop();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Register the report endpoint impls (after the inherited /health + /version). */
    protected override async registerEndpoints() : Promise<void>
    {
        await super.registerEndpoints();          // keeps /health + /version
        this.register( new PostReportRunsImpl( this ) );
        this.register( new GetReportSubmissionsImpl( this ) );
        this.register( new GetReportSubmissionImpl( this ) );
        this.register( new GetReportSubmissionDownloadImpl( this ) );
        this.register( new DeleteReportSubmissionImpl( this ) );
        this.register( new GetReportSchedulesImpl( this ) );
        this.register( new GetReportScheduleImpl( this ) );
        this.register( new PatchReportScheduleImpl( this ) );
        this.register( new PostReportSchedulePauseImpl( this ) );
        this.register( new PostReportScheduleResumeImpl( this ) );
        this.register( new DeleteReportScheduleImpl( this ) );
        this.register( new GetReportSchedulesStaleImpl( this ) );
        this.register( new PostReportInternalEraseImpl( this ) );
        this.register( new GetReportConfigImpl( this ) );
        this.register( new PutReportConfigImpl( this ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // SQS report-generate poll loop (dev drain of ReportGenerateJob) — pulls a released submission ref and
    // runs the SAME `processSubmission` pipeline the Lambda job's handler calls. Each message re-enters the
    // RequestContext from its transaction-id so generation logs stay correlated to the submitting request.
    private async startGenerateConsumer() : Promise<void>
    {
        this.log.info( "report generate consumer started (SQS report-generate)" );
        while( !this.stopping )
        {
            try
            {
                const received : Type.Result<Array<Message>> = await this.sqs.receive( "report-generate", 10, 10 );
                if( !received.ok ) { await this.delay( 5000 ); continue; }
                for( const message of received.data )
                    await RequestContext.run( { transactionId: Sqs.transactionId( message ) }, async () : Promise<void> =>
                    {
                        try
                        {
                            this.log.trace( "message received (SQS report-generate)", { messageId: message.MessageId } );
                            const job = JSON.parse( message.Body ?? "{}" ) as { accountId? : string; submissionId? : string };
                            if( job.accountId && job.submissionId ) await this.processSubmission( job.accountId, job.submissionId );
                            if( message.ReceiptHandle ) await this.sqs.delete( "report-generate", message.ReceiptHandle );
                        }
                        catch( err ) { this.log.warn( "report generation failed (will redeliver)", { error: String( err ) } ); }
                    } );
            }
            catch( error ) { this.log.warn( "report generate receive failed — backing off", { error: String( error ) } ); await this.delay( 5000 ); }
        }
        this.log.info( "report generate consumer stopped" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // SELF-SCHEDULED dispatch loop (report-12.2) — drives the `WorkQueue` governor: each round releases the
    // next paced batch of submissions onto the real report-generate queue, then sleeps until `nextWakeAt()`
    // says something could change instead of polling a fixed interval. SINGLE-FLIGHT via a Redis lock (SET
    // NX PX) — only one replica's round actually dispatches; a crash mid-round self-heals via the lock's TTL.
    private async startDispatchLoop() : Promise<void>
    {
        this.log.info( "report dispatch loop started (WorkQueue governor)" );
        while( !this.stopping )
        {
            try
            {
                if( await this.acquireDispatchLock() )
                {
                    try { await this.dispatchPending(); }
                    finally { await this.releaseDispatchLock(); }
                }
                const wakeAt : Type.ISODateTime = await this.workQueue.nextWakeAt();
                const waitMs : number = Math.min( 30000, Math.max( 250, new Date( wakeAt ).getTime() - Date.now() ) );
                await this.delay( waitMs );
            }
            catch( error ) { this.log.warn( "report dispatch round failed — backing off", { error: String( error ) } ); await this.delay( 5000 ); }
        }
        this.log.info( "report dispatch loop stopped" );
    }

    // logical key for the dispatch single-flight lock + its TTL — short enough that a crashed holder's lock
    // self-clears well within one dispatch cycle, long enough to cover a normal round.
    private static readonly DISPATCH_LOCK_KEY : string = "wq:report:dispatch:lock";
    private static readonly DISPATCH_LOCK_TTL_MS : number = 10000;

    // acquire the round's single-flight lock — `SET key value PX ttl NX` is atomic, so exactly one concurrent
    // replica ever sees "OK" for a given lock window.
    private async acquireDispatchLock() : Promise<boolean>
    {
        const acquired : string | null = await this.cache.client.set( ReportMainService.DISPATCH_LOCK_KEY, this.id, "PX", ReportMainService.DISPATCH_LOCK_TTL_MS, "NX" );
        return acquired === "OK";
    }

    // release ONLY if this replica still holds it (its id matches) — never clear a lock another replica has
    // since re-acquired after our TTL lapsed.
    private async releaseDispatchLock() : Promise<void>
    {
        const holder : string | null = await this.cache.client.get( ReportMainService.DISPATCH_LOCK_KEY );
        if( holder === this.id ) await this.cache.client.del( ReportMainService.DISPATCH_LOCK_KEY );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Stop the poll loops before the base closes the HTTP server (so the process can exit on SIGINT). */
    protected override async aboutToQuit() : Promise<void>
    {
        this.stopping = true;
        await super.aboutToQuit();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private delay( ms : number ) : Promise<void> { return new Promise( ( resolve ) => setTimeout( resolve, ms ) ); }
}

export default ReportMainService;
// eof
