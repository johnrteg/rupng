//
import { Context } from "aws-lambda";

import { Events } from "@repo/services";
import { type Type } from "@repo/common";

import MarketplaceJob from "./MarketplaceJob";
import { ConnectorFactory } from "../connectors/ConnectorFactory";
import { Connector } from "../connectors/Connector";
import { UsagePipeline } from "../pipeline/UsagePipeline";

//
// MarketplaceConnectorJob — the INBOUND half of the connector runtime (marketplace-5.0), fed by
// `PostMarketplaceWebhookImpl`'s webhook intake via the `marketplace-connector` queue:
// `connector.normalize` each verified 3rd-party payload into platform-agnostic events, meter the
// activity (marketplace-8.1), and emit each as a `marketplace.trigger_event` Kafka event.
//
// KNOWN GAP: no `workflow` consumer exists yet to react to `marketplace.trigger_event` (workflow is
// still spec-only) — the event is published (best-effort) for whenever it lands, mirroring
// `MarketplaceActionJob`'s identical "revisit once workflow lands" gap on the outbound side.
//
export class MarketplaceConnectorJob extends MarketplaceJob<unknown, void>
{
    /////////////////////////////////////////////////////////////////////
    constructor() { super( "marketplaceConnectorJob" ); }

    /////////////////////////////////////////////////////////////////////
    public async handler( event : unknown, _context : Context ) : Promise<void>
    {
        for( const ref of this.inboundRefs( event ) ) await this.normalizeAndEmit( ref );
    }

    /////////////////////////////////////////////////////////////////////
    private async normalizeAndEmit( ref : MarketplaceConnectorJob.InboundRef ) : Promise<void>
    {
        const connector : Connector | undefined = ConnectorFactory.for( ref.integrationId );
        if( !connector )
        {
            this.log.warn( "connector: no connector registered", { integrationId: ref.integrationId } );
            return;
        }

        const events : Array<Connector.RawEvent> = connector.normalize( ref.payload, ref.headers );
        for( const raw of events )
        {
            const published : Type.Result<void> = await this.kafka.publishEvent( Events.envelope( {
                object: Events.Object.MARKETPLACE_TRIGGER_EVENT, verb: Events.Verb.CREATED, accountId: ref.accountId,
                target: { type: "marketplace.trigger_event", id: raw.externalId },
                data:   { id: raw.externalId, accountId: ref.accountId, installationId: ref.installationId, integrationId: ref.integrationId, key: raw.key, occurredAt: raw.occurredAt },
            } ) );
            if( !published.ok ) this.log.warn( "trigger event publish failed", { installationId: ref.installationId, key: raw.key, error: published.error } );
        }

        if( events.length > 0 )
        {
            const reported : Type.Result<void> = await UsagePipeline.report( { dynamo: this.dynamo }, ref.accountId, ref.integrationId, undefined, { records: events.length } );
            if( !reported.ok ) this.log.warn( "connector: usage report failed", { installationId: ref.installationId, error: reported.error } );
        }
    }

    /////////////////////////////////////////////////////////////////////
    /** Parse the inbound webhook refs out of an SQS Lambda event's records. */
    private inboundRefs( event : unknown ) : Array<MarketplaceConnectorJob.InboundRef>
    {
        const records : Array<{ body? : string }> = ( event as { Records? : Array<{ body? : string }> } )?.Records ?? [];
        const refs : Array<MarketplaceConnectorJob.InboundRef> = [];
        for( const record of records )
        {
            try
            {
                const parsed : Partial<MarketplaceConnectorJob.InboundRef> = JSON.parse( record.body ?? "{}" );
                if( parsed.accountId && parsed.installationId && parsed.integrationId )
                    refs.push( { accountId: parsed.accountId, installationId: parsed.installationId, integrationId: parsed.integrationId, payload: parsed.payload, headers: parsed.headers ?? {} } );
            }
            catch { /* skip a malformed record */ }
        }
        return refs;
    }
}

export namespace MarketplaceConnectorJob
{
    export interface InboundRef
    {
        accountId:      Type.UUID;
        installationId: Type.UUID;
        integrationId:  string;
        payload:        unknown;
        headers:        Record<string, string | undefined>;
    }
}

//
// Lambda entrypoint — manifest `jobs.marketplaceConnectorJob`, handler "jobs/MarketplaceConnectorJob.handler".
//
const job : MarketplaceConnectorJob = new MarketplaceConnectorJob();
export const handler = ( event : unknown, context : Context ) : Promise<void> => job.invoke( event, context );

export default MarketplaceConnectorJob;
// eof
