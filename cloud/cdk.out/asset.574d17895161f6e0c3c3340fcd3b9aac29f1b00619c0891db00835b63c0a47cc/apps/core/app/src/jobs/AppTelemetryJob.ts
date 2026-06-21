//
import type { Context, SQSEvent } from "aws-lambda";

import AppJob from "./AppJob";

//
// AppTelemetryJob — consumes the browser-facing telemetry intake queue: enrich (auth ctx,
// transactionId) + PII-scrub, then route errors → monitor and product events → analytics. Absorbs
// bursts off the intake path. (SPECS app-5.2 / 5.3, app-6.1) Optional for MVP — the intake can scrub
// + forward inline until volume justifies decoupling onto this queue.
//
export class AppTelemetryJob extends AppJob<SQSEvent, void>
{
    /////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( "telemetry" );
    }

    /////////////////////////////////////////////////////////////////////
    public async handler( event : SQSEvent, _context : Context ) : Promise<void>
    {
        // TODO(app-5.2/5.3, app-6.1): per record → enrich + PII-scrub → route error→monitor /
        // product-event→analytics. Idempotent on the producer event id.
        this.log.info( "AppTelemetryJob", { records: event.Records?.length ?? 0 } );
    }
}

//
// Lambda entrypoint — manifest `jobs.telemetry`, handler "jobs/AppTelemetryJob.handler".
//
const job : AppTelemetryJob = new AppTelemetryJob();
export const handler = ( event : SQSEvent, context : Context ) : Promise<void> => job.invoke( event, context );

export default AppTelemetryJob;
