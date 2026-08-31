//
import { Context } from "aws-lambda";

import type { Type } from "@repo/common";

import RegistrationJob from "./RegistrationJob";
import { RegistrationDomain } from "../domain/RegistrationDomain";

//
// RegistrationVettingJob — the external-vetting worker (registration-11.3/7.2). SQS-triggered from
// `registration-vetting`; each message names one brand to re-vet.
//
// The domain does the work: order the EVP run at TCR (or open/read a Campaign Verify verification for a
// political brand), mirror the resulting class/score onto the projection, record the VETTING cost estimate,
// and — only when the score crosses into a different MPS tier — re-publish trust-score → MPS for every
// campaign under the brand. The tier check matters: dispatch consumes those events to re-pace, so emitting
// one for a one-point score drift would be churn, not information.
//
export class RegistrationVettingJob extends RegistrationJob<unknown, void>
{
    /////////////////////////////////////////////////////////////////////
    constructor() { super( "registrationVettingJob" ); }

    /////////////////////////////////////////////////////////////////////
    public async handler( event : unknown, _context : Context ) : Promise<void>
    {
        for( const record of this.sqsRecords( event ) ) await this.runOne( record.body as unknown as RegistrationDomain.VettingMessage );
    }

    /////////////////////////////////////////////////////////////////////
    // refresh ONE brand's vetting through the shared domain object
    private async runOne( message : RegistrationDomain.VettingMessage ) : Promise<void>
    {
        if( !message.accountId || !message.brandId ) { this.log.warn( "vetting job: message names no brand" ); return; }
        this.log.trace( "vetting job: start", { accountId: message.accountId, brandId: message.brandId } );

        const done : Type.Result<void> = await this.domain.processVetting( message.accountId, message.brandId );
        if( !done.ok )
        {
            this.log.warn( "vetting job failed (will redeliver)", { accountId: message.accountId, brandId: message.brandId, error: done.error } );
            throw new Error( done.error );
        }
        this.log.info( "vetting job completed", { accountId: message.accountId, brandId: message.brandId, jobId: message.jobId } );
    }
}

//
// Lambda entrypoint — manifest `jobs.registrationVettingJob`, handler "jobs/RegistrationVettingJob.handler".
//
const job : RegistrationVettingJob = new RegistrationVettingJob();
export const handler = ( event : unknown, context : Context ) : Promise<void> => job.invoke( event, context );

export default RegistrationVettingJob;
// eof
