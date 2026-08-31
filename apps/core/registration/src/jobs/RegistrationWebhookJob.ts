//
import { Context } from "aws-lambda";

import type { Type } from "@repo/common";

import RegistrationJob from "./RegistrationJob";
import { RegistrationDomain } from "../domain/RegistrationDomain";

//
// RegistrationWebhookJob — the callback processor (registration-5.2/7.1). Fed by BOTH intake queues
// (`registration-webhook-tcr` and `registration-webhook-cv`) from a single Lambda: the manifest's `triggers`
// is an array, so one function can own two event sources, and one function means one place where "what does
// this callback mean" is decided.
//
// It routes on the record's SOURCE QUEUE ARN rather than sniffing the payload — the intake role already knew
// which provider signed the request, and re-deriving that from an untyped body would be guessing.
//
// The payload arriving here has ALREADY been signature-verified by the webhook role; this job's contract is
// "interpret a trusted callback", never "decide whether to trust it".
//
export class RegistrationWebhookJob extends RegistrationJob<unknown, void>
{
    /////////////////////////////////////////////////////////////////////
    constructor() { super( "registrationWebhookJob" ); }

    /////////////////////////////////////////////////////////////////////
    public async handler( event : unknown, _context : Context ) : Promise<void>
    {
        for( const record of this.sqsRecords( event ) ) await this.runOne( record );
    }

    /////////////////////////////////////////////////////////////////////
    // process ONE verified callback through the shared domain object, picking the processor by source queue
    private async runOne( record : RegistrationJob.SqsRecord ) : Promise<void>
    {
        const stream : RegistrationDomain.WebhookStream = RegistrationWebhookJob.streamOf( record.sourceArn );
        this.log.trace( "webhook job: start", { stream } );

        const done : Type.Result<void> = stream === RegistrationDomain.WebhookStream.CV
            ? await this.domain.processCvWebhook( record.body )
            : await this.domain.processTcrWebhook( record.body );

        // a callback we couldn't apply is retried via redelivery — but an UNMAPPED event is not a failure
        // (the domain acks those), so anything reaching here really is a processing problem
        if( !done.ok )
        {
            this.log.warn( "webhook job failed (will redeliver)", { stream, error: done.error } );
            throw new Error( done.error );
        }
    }

    /////////////////////////////////////////////////////////////////////
    // which provider stream a record came from, read off its source queue ARN (which ends in the queue name)
    private static streamOf( sourceArn : string ) : RegistrationDomain.WebhookStream
    {
        return sourceArn.endsWith( RegistrationDomain.WEBHOOK_QUEUE[ RegistrationDomain.WebhookStream.CV ] )
            ? RegistrationDomain.WebhookStream.CV
            : RegistrationDomain.WebhookStream.TCR;
    }
}

//
// Lambda entrypoint — manifest `jobs.registrationWebhookJob`, handler "jobs/RegistrationWebhookJob.handler".
//
const job : RegistrationWebhookJob = new RegistrationWebhookJob();
export const handler = ( event : unknown, context : Context ) : Promise<void> => job.invoke( event, context );

export default RegistrationWebhookJob;
// eof
