//
import type { Context, SQSEvent } from "aws-lambda";

import AppJob from "./AppJob";

//
// AppTicketJob — drains the ticket-alert queue (registration `pending_review` from access-flows;
// billing / dunning) and opens a support ticket via the ticket-provider factory. Retries + DLQ so a
// provider outage never blocks signup. (SPECS app-4.3)
//
export class AppTicketJob extends AppJob<SQSEvent, void>
{
    /////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( "ticket" );
    }

    /////////////////////////////////////////////////////////////////////
    public async handler( event : SQSEvent, _context : Context ) : Promise<void>
    {
        // TODO(app-4.3): per record → resolve account/context → TicketProvider.open(...);
        // throw on failure so SQS redrives → DLQ after maxReceiveCount.
        this.log.info( "AppTicketJob", { records: event.Records?.length ?? 0 } );
    }
}

//
// Lambda entrypoint — manifest `jobs.ticket`, handler "jobs/AppTicketJob.handler".
//
const job : AppTicketJob = new AppTicketJob();
export const handler = ( event : SQSEvent, context : Context ) : Promise<void> => job.invoke( event, context );

export default AppTicketJob;
