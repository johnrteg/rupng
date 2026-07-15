//

import { Context } from 'aws-lambda';

import { Application } from './Application';
import { RequestContext } from './RequestContext';
import type { Register } from '@repo/system';
/*
Jobs are short run functions that might be called from:
1) SQS pipe
2) S3 event change
3) Scheduled cron activity

TEvent  - the Lambda trigger payload (e.g. SQSEvent, S3Event, ScheduledEvent from 'aws-lambda')
TResult - the value returned to the Lambda runtime
*/

export abstract class Job<TEvent = any, TResult = any> extends Application
{
    // resolves once the per-container cold-start bootstrap (config/init/start) has completed
    private coldStart ?: Promise<void>;

    ////////////////////////////////////////////////////////////////////////
    /**
    * @param service  the canonical service id (`Register.Service.*`) this job belongs to.
    * @param jobName   optional job name distinguishing jobs of one service (e.g. `ticket`) → name `service:jobName`.
    */
    constructor( service : Register.Service, jobName ? : string )
    {
        super( service, jobName );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Cold-start hook: loads configuration before the job handles any events. Override to fetch
    * job-specific config and call super.config() to preserve base behavior. Runs once per
    * execution environment as part of invoke()'s bootstrap.
    */
    protected async config() : Promise<void>
    {
        await super.config();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Cold-start hook: initializes long-lived resources (database connections, secrets, clients)
    * once per execution environment. Override and call super.init().
    */
    protected async init() : Promise<void>
    {
        await super.init();
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Cold-start hook: final setup step, run after config() and init(). Override and call
    * super.start().
    */
    protected async start() : Promise<void>
    {
        await super.start();
    }

    //////////////////////////////////////////////////////////////////////////////////////////
    // The AWS Lambda entrypoint. Wire a bound instance to the exported handler, e.g.:
    //
    //   const job : MyJob = new MyJob('my-job');
    //   export const handler = ( event, context ) => job.invoke( event, context );
    //
    // The cold-start bootstrap (config -> init -> start, via run()) runs exactly once per
    // execution environment and is reused on warm invocations; only handler() runs per call.
    public async invoke( event: TEvent, context: Context ) : Promise<TResult>
    {
        if( !this.coldStart )this.coldStart = this.run();

        try
        {
            await this.coldStart;
        }
        catch( err : any )
        {
            // a failed bootstrap must not poison warm invocations - allow the next call to retry
            this.coldStart = undefined;
            throw err;
        }

        // a Job started FROM a queue/event inherits that message's transaction id (SQS attribute / event
        // detail), so the whole chain — the request that enqueued it, this job, and anything it fans out — stays
        // correlated. Best-effort extraction; mints nothing (a job with no upstream id simply runs without one).
        return RequestContext.run( { transactionId: Job.transactionIdOf( event ) }, () => this.handler( event, context ) );
    }

    ////////////////////////////////////////////////////////////////////////
    // Best-effort read of the transaction id off a Lambda trigger payload: SQS record message attribute,
    // EventBridge `detail`, or a top-level field. Returns undefined when the trigger carries none.
    private static transactionIdOf( event : unknown ) : string | undefined
    {
        const e = event as {
            Records?      : Array<{ messageAttributes? : Record<string, { stringValue? : string; StringValue? : string }> }>;
            detail?       : { transactionId? : string; source? : { transactionId? : string } };
            transactionId? : string;
        } | null | undefined;
        if( !e ) return undefined;

        const attr = e.Records?.[ 0 ]?.messageAttributes?.transactionId;
        if( attr?.stringValue ) return attr.stringValue;
        if( attr?.StringValue ) return attr.StringValue;
        if( e.detail?.source?.transactionId ) return e.detail.source.transactionId;
        if( e.detail?.transactionId ) return e.detail.transactionId;
        if( e.transactionId ) return e.transactionId;
        return undefined;
    }

    ////////////////////////////////////////////////////////////////////////
    // Per-invocation Lambda logic - must be implemented by the concrete subclass.
    public abstract handler( event: TEvent, context: Context ): Promise<TResult>;

    ////////////////////////////////////////////////////////////////////////
    /**
    * Cleanup hook invoked before the job shuts down - flush buffers, close connections, etc.
    * Override and call super.aboutToQuit().
    */
    protected async aboutToQuit() : Promise<void>
    {
        await super.aboutToQuit();
    }

}

export default Job;
