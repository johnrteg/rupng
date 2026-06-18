//

import { Context } from 'aws-lambda';

import { Application } from './Application';
import type { Events } from '@repo/events';
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
    * @param service  the canonical service id (`Events.Service.*`) this job belongs to.
    * @param jobName   optional job name distinguishing jobs of one service (e.g. `ticket`) → name `service:jobName`.
    */
    constructor( service : Events.Service, jobName ? : string )
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

        return this.handler( event, context );
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
