//
import { Context } from "aws-lambda";

import { Registration, PhoneNumber } from "@repo/api";
import type { Type } from "@repo/common";

import RegistrationJob from "./RegistrationJob";
import { RegistrationDomain } from "../domain/RegistrationDomain";

//
// RegistrationPollJob — the reconciliation sweep (registration-5.3). EventBridge fires it on a dumb outer
// cadence (`rate(5 minutes)`); ALL of the intelligence is here and in the projection's own bookkeeping:
//
//   • IN-FLIGHT ONLY — a row in a terminal status is skipped outright (`RegistrationStateMachine`'s
//     TERMINAL_* sets), so an approved brand or an active campaign costs nothing per sweep forever.
//   • BACK OFF — every row carries `nextPollAt`, recomputed on each transition from the configured
//     `pollSweep` backoff. A row that keeps reporting the same status is polled exponentially less often.
//   • STOP ON TERMINAL — reaching a terminal status CLEARS `nextPollAt`, which is what takes the row out of
//     the candidate set permanently (until a resubmit/reprovision/override puts it back in flight).
//
// This is the "same self-scheduling discipline as dispatch" SPECS.md asks for, and it is why the sweep can
// be a cheap scan rather than needing its own index.
//
// It calls exactly the same `reconcileOne` the on-demand check&sync endpoint calls (registration-11.8) —
// there is one reconcile, invoked from two places.
//
export class RegistrationPollJob extends RegistrationJob<unknown, void>
{
    /////////////////////////////////////////////////////////////////////
    constructor() { super( "registrationPollJob" ); }

    /////////////////////////////////////////////////////////////////////
    public async handler( _event : unknown, _context : Context ) : Promise<void>
    {
        const startedAt : Date = new Date();

        // gather the two due sets, then reconcile each. A read failure on one set must not abort the other —
        // a brand-table blip shouldn't stall campaign reconciliation for the whole sweep interval.
        const brands : Type.Result<Array<Registration.Brand>> = await this.domain.dueBrands( startedAt );
        if( brands.ok ) await this.sweepBrands( brands.data );
        else this.log.warn( "poll sweep: brand candidate read failed", { error: brands.error } );

        const campaigns : Type.Result<Array<Registration.Campaign>> = await this.domain.dueCampaigns( startedAt );
        if( campaigns.ok ) await this.sweepCampaigns( campaigns.data );
        else this.log.warn( "poll sweep: campaign candidate read failed", { error: campaigns.error } );

        // numbers with an in-flight TFV (registration-4.x extension) — same due/backoff discipline, its own
        // candidate set alongside brands/campaigns in this ONE sweep rather than a second Lambda/EventBridge rule.
        const numbers : Type.Result<Array<PhoneNumber.PhoneNumber>> = await this.domain.dueNumbers( startedAt );
        if( numbers.ok ) await this.sweepNumbers( numbers.data );
        else this.log.warn( "poll sweep: number candidate read failed", { error: numbers.error } );

        this.log.info( "poll sweep complete", {
            brands: brands.ok ? brands.data.length : 0,
            campaigns: campaigns.ok ? campaigns.data.length : 0,
            numbers: numbers.ok ? numbers.data.length : 0,
            elapsedMs: Date.now() - startedAt.getTime(),
        } );
    }

    /////////////////////////////////////////////////////////////////////
    // reconcile every due brand — one failure is logged and skipped, never fatal to the sweep
    private async sweepBrands( brands : Array<Registration.Brand> ) : Promise<void>
    {
        for( const brand of brands )
        {
            const reconciled : Type.Result<RegistrationDomain.EntityResult> = await this.domain.reconcileOne( brand.accountId, { brandId: brand.brandId } );
            if( !reconciled.ok ) this.log.warn( "poll sweep: brand reconcile failed", { accountId: brand.accountId, brandId: brand.brandId, error: reconciled.error } );
        }
    }

    /////////////////////////////////////////////////////////////////////
    // reconcile every due campaign, then — for the ones that are live — cross-check their numbers against the
    // carrier's own pairing view. A number the carrier has disowned is drift the status reconcile can't see,
    // since TCR's campaign status says nothing about whether a specific line is still attached.
    private async sweepCampaigns( campaigns : Array<Registration.Campaign> ) : Promise<void>
    {
        for( const campaign of campaigns )
        {
            const reconciled : Type.Result<RegistrationDomain.EntityResult> = await this.domain.reconcileOne( campaign.accountId, { campaignId: campaign.campaignId } );
            if( !reconciled.ok ) { this.log.warn( "poll sweep: campaign reconcile failed", { accountId: campaign.accountId, campaignId: campaign.campaignId, error: reconciled.error } ); continue; }

            const settled : Registration.Campaign | undefined = reconciled.data.campaign;
            if( settled === undefined || settled.phoneNumbers.length === 0 ) continue;

            const drifted : Type.Result<Array<string>> = await this.domain.detectNumberDrift( settled );
            if( !drifted.ok ) { this.log.warn( "poll sweep: number drift check failed", { campaignId: settled.campaignId, error: drifted.error } ); continue; }
            // surfaced, not auto-healed: silently re-provisioning a line the carrier dropped could re-buy a
            // number the account deliberately released. An operator drives the reprovision.
            if( drifted.data.length > 0 ) this.log.warn( "poll sweep: numbers no longer paired at the carrier", { campaignId: settled.campaignId, drifted: drifted.data } );
        }
    }

    /////////////////////////////////////////////////////////////////////
    // reconcile every due number — today this only backs off `nextPollAt` and logs (no carrier exposes a
    // verified TFV status-check call yet; see RegistrationDomain.reconcileNumber's own note).
    private async sweepNumbers( numbers : Array<PhoneNumber.PhoneNumber> ) : Promise<void>
    {
        for( const number of numbers )
        {
            const reconciled : Type.Result<void> = await this.domain.reconcileNumber( number.accountId, number.id );
            if( !reconciled.ok ) this.log.warn( "poll sweep: number reconcile failed", { accountId: number.accountId, id: number.id, error: reconciled.error } );
        }
    }
}

//
// Lambda entrypoint — manifest `jobs.registrationPollJob`, handler "jobs/RegistrationPollJob.handler".
//
const job : RegistrationPollJob = new RegistrationPollJob();
export const handler = ( event : unknown, context : Context ) : Promise<void> => job.invoke( event, context );

export default RegistrationPollJob;
// eof
