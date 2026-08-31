//
import { Context } from "aws-lambda";

import type { Type } from "@repo/common";

import RegistrationJob from "./RegistrationJob";
import { RegistrationDomain } from "../domain/RegistrationDomain";

//
// RegistrationSubmitJob — the external-write worker (registration-2.0/3.2/4.0/11.x). SQS-triggered from
// `registration-submit`; each message is a submit, a resubmit, or a reprovision, and each is one or more
// calls out to TCR or a carrier — exactly the kind of slow, retryable, external work that must never run in
// a request handler.
//
// IDEMPOTENCY (registration-12.4): SQS is at-least-once, and the guard is the STATE MACHINE, not a dedupe
// table. A redelivered SUBMIT for an already-submitted entity fails its DRAFT → SUBMITTED transition check
// inside the domain and is logged, so TCR never sees a duplicate brand/campaign. A redelivered REPROVISION
// appends numbers rather than replacing them, and is capped by `maxLinesPerCampaign`.
//
// A message that fails is deliberately RETHROWN so the Lambda reports a batch failure and SQS redelivers it
// (and eventually dead-letters it) — swallowing it here would silently lose a registration.
//
export class RegistrationSubmitJob extends RegistrationJob<unknown, void>
{
    /////////////////////////////////////////////////////////////////////
    constructor() { super( "registrationSubmitJob" ); }

    /////////////////////////////////////////////////////////////////////
    public async handler( event : unknown, _context : Context ) : Promise<void>
    {
        for( const record of this.sqsRecords( event ) ) await this.runOne( record.body as unknown as RegistrationDomain.SubmitMessage );
    }

    /////////////////////////////////////////////////////////////////////
    // execute ONE queued submit/resubmit/reprovision through the shared domain object
    private async runOne( message : RegistrationDomain.SubmitMessage ) : Promise<void>
    {
        this.log.trace( "submit job: start", { kind: message.kind, accountId: message.accountId, brandId: message.brandId, campaignId: message.campaignId } );

        const done : Type.Result<void> = await this.domain.processSubmit( message );
        if( !done.ok )
        {
            this.log.warn( "submit job failed (will redeliver)", { kind: message.kind, accountId: message.accountId, error: done.error } );
            throw new Error( done.error );
        }
        this.log.info( "submit job completed", { kind: message.kind, accountId: message.accountId, jobId: message.jobId } );
    }
}

//
// Lambda entrypoint — manifest `jobs.registrationSubmitJob`, handler "jobs/RegistrationSubmitJob.handler".
//
const job : RegistrationSubmitJob = new RegistrationSubmitJob();
export const handler = ( event : unknown, context : Context ) : Promise<void> => job.invoke( event, context );

export default RegistrationSubmitJob;
// eof
