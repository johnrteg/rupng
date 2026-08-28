//
import { Context } from "aws-lambda";
import { ScanCommand, type ScanCommandOutput } from "@aws-sdk/lib-dynamodb";

import { SocialAccount, SocialConfig } from "@repo/api";
import { ResultUtils, type Type } from "@repo/common";

import SocialJob from "./SocialJob";
import { AdapterFactory } from "../adapters/AdapterFactory";
import { SocialAdapter } from "../adapters/SocialAdapter";

//
// SocialPollJob — polls pull-only platforms (X / TikTok / LinkedIn) for inbound, per
// apps/core/social/SPECS.md §9.6. Two entry points, both landing here:
//   - on-demand: `social-poll` SQS messages (from `PostInboxRefresh`), one connection each.
//   - periodic: an EventBridge rule invokes with no event body — sweeps every due connection
//     (cadence elapsed, not already in flight) across ALL accounts. A full table scan (connections is
//     small relative to a 15-minute cadence); revisit if that stops being true.
// Either way, normalized raw items are enqueued to `social-inbound` for `SocialInboundJob` to process —
// ONE normalize funnel regardless of source (SPECS.md's "inbound is asymmetric… one pipeline").
//
export class SocialPollJob extends SocialJob<unknown, void>
{
    /////////////////////////////////////////////////////////////////////
    constructor() { super( "socialPollJob" ); }

    /////////////////////////////////////////////////////////////////////
    public async handler( event : unknown, _context : Context ) : Promise<void>
    {
        const onDemand : Array<{ accountId : string; connectionId : string }> = this.connectionRefs( event );
        if( onDemand.length > 0 )
        {
            for( const ref of onDemand ) await this.pollConnection( ref.accountId, ref.connectionId );
            return;
        }

        // periodic sweep — no on-demand refs means this is the EventBridge cadence trigger
        const due : Array<{ accountId : string; id : string }> = await this.dueConnections();
        for( const connection of due ) await this.pollConnection( connection.accountId, connection.id );
    }

    /////////////////////////////////////////////////////////////////////
    /** Poll one connection, enqueue its normalized-raw items, then release the in-flight lock and
     *  record the outcome (success clears `lastError`; failure surfaces it — SPECS.md's alert surface). */
    private async pollConnection( accountId : Type.UUID, connectionId : Type.UUID ) : Promise<void>
    {
        const got : Type.Result<SocialAccount.Entity | undefined> = await this.dynamo.get<SocialAccount.Entity>( "connections", { accountId, id: connectionId } );
        if( !got.ok || !got.data ) { this.log.warn( "poll: connection not found", { accountId, connectionId } ); return; }
        const connection : SocialAccount.Entity = got.data;

        const adapter : SocialAdapter | undefined = AdapterFactory.for( connection.platform );
        const config : SocialConfig.Config = await this.socialConfig();
        const cadenceSeconds : number = connection.pull?.cadenceSeconds ?? config.poll.cadenceSeconds;
        const cooldownSeconds : number = connection.pull?.cooldownSeconds ?? config.refresh.cooldownSeconds;
        const now : Type.ISODateTime = new Date().toISOString();
        const sinceISO : Type.ISODateTime = connection.pull?.lastPullAt ?? new Date( Date.now() - config.poll.windowSeconds * 1000 ).toISOString();

        let lastError : string | undefined;
        if( !adapter?.pollInbound ) lastError = `no poll support for platform ${ connection.platform }`;
        else
        {
            const token : Type.Result<{ accessToken : string }> = await this.marketplace.token( connection.marketplaceInstallationId );
            if( !token.ok ) lastError = "marketplace token resolution failed";
            else
            {
                const polled : Type.Result<Array<SocialAdapter.RawInbound>> = await adapter.pollInbound( connectionId, token.data.accessToken, sinceISO );
                if( !polled.ok ) lastError = polled.error;
                else
                    for( const item of polled.data )
                    {
                        const enqueued : Type.Result<void> = await this.sqs.send( "social-inbound", { accountId, connectionId, platform: connection.platform, item } );
                        if( !enqueued.ok ) this.log.warn( "poll: inbound enqueue failed", { accountId, connectionId, error: enqueued.error } );
                    }
            }
        }

        const wrote : Type.Result<void> = await this.dynamo.put( "connections", { ...connection, pull: {
            cadenceSeconds, cooldownSeconds,
            status:        SocialAccount.PullStatus.IDLE,
            lastPullAt:    now,
            cooldownUntil: new Date( Date.now() + cooldownSeconds * 1000 ).toISOString(),
            lastError,
        } } );
        if( !wrote.ok ) this.log.warn( "poll: connection pull-state write failed", { accountId, connectionId, error: wrote.error } );
    }

    /////////////////////////////////////////////////////////////////////
    /** The live SocialConfig — jobs can't reach the protected `appConfig` a Service exposes, so this
     *  reads it directly (mirrors `SocialService.socialConfig`). */
    private async socialConfig() : Promise<SocialConfig.Config>
    {
        const got : Type.Result<SocialConfig.Config | undefined> = await this.appConfig.json<SocialConfig.Config>( "config", "settings" );
        return got.ok && got.data ? { ...SocialConfig.DEFAULT, ...got.data } : SocialConfig.DEFAULT;
    }

    /////////////////////////////////////////////////////////////////////
    /** Every connection whose poll cadence has elapsed and isn't already in flight. */
    private async dueConnections() : Promise<Array<{ accountId : string; id : string }>>
    {
        const scanned : Type.Result<Array<SocialAccount.Entity>> = await ResultUtils.from( async () : Promise<Array<SocialAccount.Entity>> =>
        {
            const result : ScanCommandOutput = await this.dynamo.client.send( new ScanCommand( { TableName: this.dynamo.table( "connections" ) } ) );
            return ( result.Items ?? [] ) as Array<SocialAccount.Entity>;
        } );
        if( !scanned.ok ) { this.log.warn( "poll sweep: connections scan failed", { error: scanned.error } ); return []; }

        const now : number = Date.now();
        return scanned.data
            .filter( ( connection : SocialAccount.Entity ) : boolean => !!AdapterFactory.for( connection.platform )?.pollInbound )
            .filter( ( connection : SocialAccount.Entity ) : boolean => connection.pull?.status !== SocialAccount.PullStatus.IN_FLIGHT )
            .filter( ( connection : SocialAccount.Entity ) : boolean =>
            {
                const cadenceMs : number = ( connection.pull?.cadenceSeconds ?? 900 ) * 1000;
                const lastPullMs : number = connection.pull?.lastPullAt ? Date.parse( connection.pull.lastPullAt ) : 0;
                return now - lastPullMs >= cadenceMs;
            } )
            .map( ( connection : SocialAccount.Entity ) : { accountId : string; id : string } => ( { accountId: connection.accountId, id: connection.id } ) );
    }
}

//
// Lambda entrypoint — manifest `jobs.socialPollJob`, handler "jobs/SocialPollJob.handler".
//
const job : SocialPollJob = new SocialPollJob();
export const handler = ( event : unknown, context : Context ) : Promise<void> => job.invoke( event, context );

export default SocialPollJob;
// eof
