//
import { Context } from "aws-lambda";

import { Marketplace } from "@repo/api";
import { type Type } from "@repo/common";
import { OAuthFactory, OAuth } from "@repo/oauth";

import MarketplaceJob from "./MarketplaceJob";
import { UsagePipeline } from "../pipeline/UsagePipeline";

//
// MarketplaceActionJob — the outbound half of the connector runtime (marketplace-4.2/10.3), but
// PROVIDER-AGNOSTIC: it routes a plain REST call through the OAuth broker's `proxy` (auth injected,
// no token handling here) rather than a per-connector `execute()`. This covers the common case (a
// workflow action node hitting a provider's REST API) without needing a hand-built connector SDK —
// see apps/core/marketplace/SPECS.md gap #2 ("a connector is both a workflow-node plugin and a
// standalone service"). A connector needing bespoke request shaping beyond "call this REST endpoint"
// gets a native adapter later; this job is the generic fallback, not a replacement for that.
//
// KNOWN GAP: no result-delivery path back to the caller yet (no `workflow` service exists to notify) —
// success/failure is logged only. Revisit once workflow lands.
//
export class MarketplaceActionJob extends MarketplaceJob<unknown, void>
{
    /////////////////////////////////////////////////////////////////////
    constructor() { super( "marketplaceActionJob" ); }

    /////////////////////////////////////////////////////////////////////
    public async handler( event : unknown, _context : Context ) : Promise<void>
    {
        for( const ref of this.actionRefs( event ) ) await this.runAction( ref );
    }

    /////////////////////////////////////////////////////////////////////
    private async runAction( ref : MarketplaceActionJob.ActionRef ) : Promise<void>
    {
        const got : Type.Result<Marketplace.Installation | undefined> = await this.dynamo.get<Marketplace.Installation>( "installations", { installationId: ref.installationId } );
        if( !got.ok || !got.data || got.data.accountId !== ref.accountId )
        {
            this.log.warn( "action: installation not found", { installationId: ref.installationId } );
            return;
        }
        const installation : Marketplace.Installation = got.data;

        const result : Type.Result<unknown> = await OAuthFactory.for( installation.integrationId ).proxy(
            installation.integrationId, installation.installationId, { method: ref.method, endpoint: ref.endpoint, params: ref.params, data: ref.data } );

        if( !result.ok ) { this.log.warn( "action failed", { installationId: ref.installationId, endpoint: ref.endpoint, error: result.error } ); return; }

        this.log.info( "action succeeded", { installationId: ref.installationId, endpoint: ref.endpoint } );
        const reported : Type.Result<void> = await UsagePipeline.report( { dynamo: this.dynamo }, installation.accountId, installation.integrationId, installation.instanceId, { actions: 1 } );
        if( !reported.ok ) this.log.warn( "action: usage report failed", { installationId: ref.installationId, error: reported.error } );
    }

    /////////////////////////////////////////////////////////////////////
    /** Parse the outbound-action refs out of an SQS Lambda event's records. */
    private actionRefs( event : unknown ) : Array<MarketplaceActionJob.ActionRef>
    {
        const records : Array<{ body? : string }> = ( event as { Records? : Array<{ body? : string }> } )?.Records ?? [];
        const refs : Array<MarketplaceActionJob.ActionRef> = [];
        for( const record of records )
        {
            try
            {
                const parsed : Partial<MarketplaceActionJob.ActionRef> = JSON.parse( record.body ?? "{}" );
                if( parsed.accountId && parsed.installationId && parsed.method && parsed.endpoint )
                    refs.push( { accountId: parsed.accountId, installationId: parsed.installationId, method: parsed.method, endpoint: parsed.endpoint, params: parsed.params, data: parsed.data } );
            }
            catch { /* skip a malformed record */ }
        }
        return refs;
    }
}

export namespace MarketplaceActionJob
{
    export interface ActionRef
    {
        accountId:      Type.UUID;
        installationId: Type.UUID;
        method:         OAuth.HttpMethod;
        endpoint:       string;
        params?:        Type.JsonObject;
        data?:          Type.Json;
    }
}

//
// Lambda entrypoint — manifest `jobs.marketplaceActionJob`, handler "jobs/MarketplaceActionJob.handler".
//
const job : MarketplaceActionJob = new MarketplaceActionJob();
export const handler = ( event : unknown, context : Context ) : Promise<void> => job.invoke( event, context );

export default MarketplaceActionJob;
// eof
