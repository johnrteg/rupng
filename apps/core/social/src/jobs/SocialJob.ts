//
import { Application, Job, Register, Dynamo, Sqs, Kafka } from "@repo/services";
import { SocialAccount } from "@repo/api";

import { MarketplaceClient } from "../clients/MarketplaceClient";
import { SocialPipeline } from "../pipeline/SocialPipeline";
import { InboundPipeline } from "../pipeline/InboundPipeline";
import { SocialAdapter } from "../adapters/SocialAdapter";

//
// common social job base — the domain base every concrete social Job extends (mirrors SocialService
// on the HTTP side). Holds the facades + the shared SocialPipeline deps, so publish runs the SAME code
// whether drained locally by SocialMainService or executed as a Lambda here. Concrete jobs extend THIS.
//
export abstract class SocialJob<TEvent = unknown, TResult = void> extends Job<TEvent, TResult>
{
    protected pkg : Application.PackageInfo;

    private _dynamo?      : Dynamo;
    private _sqs?         : Sqs;
    private _kafka?       : Kafka;
    private _marketplace? : MarketplaceClient;

    ///////////////////////////////////////////////////////////////////////////////////////
    constructor( name : string )
    {
        super( Register.Service.SOCIAL, name );
        this.pkg = this.loadPackageInfo( __dirname );
        this.log.info( "version", { name: this.pkg.name, version: this.pkg.version } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    protected get dynamo()      : Dynamo           { return this._dynamo      ??= new Dynamo( this.cloud ); }
    protected get sqs()         : Sqs              { return this._sqs         ??= new Sqs( this.cloud ); }
    protected get kafka()       : Kafka            { return this._kafka       ??= new Kafka( this.cloud ); }
    protected get marketplace() : MarketplaceClient { return this._marketplace ??= new MarketplaceClient(); }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** The facades the shared `SocialPipeline` needs. */
    protected pipelineDeps() : SocialPipeline.Deps
    {
        return { dynamo: this.dynamo, sqs: this.sqs, kafka: this.kafka, log: this.log, marketplace: this.marketplace };
    }

    /** The facades the shared `InboundPipeline` needs. */
    protected inboundPipelineDeps() : InboundPipeline.Deps
    {
        return { dynamo: this.dynamo, log: this.log };
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Parse the `{ accountId, postId }` refs out of an SQS Lambda event's records. */
    protected postRefs( event : unknown ) : Array<{ accountId : string; postId : string }>
    {
        const records : Array<{ body? : string }> = ( event as { Records? : Array<{ body? : string }> } )?.Records ?? [];
        const refs : Array<{ accountId : string; postId : string }> = [];
        for( const record of records )
        {
            try
            {
                const parsed : { accountId? : string; postId? : string } = JSON.parse( record.body ?? "{}" );
                if( parsed.accountId && parsed.postId ) refs.push( { accountId: parsed.accountId, postId: parsed.postId } );
            }
            catch { /* skip a malformed record */ }
        }
        return refs;
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Parse the `{ accountId, connectionId }` refs out of an SQS Lambda event's records
     *  (`social-poll`'s on-demand Refresh trigger). */
    protected connectionRefs( event : unknown ) : Array<{ accountId : string; connectionId : string }>
    {
        const records : Array<{ body? : string }> = ( event as { Records? : Array<{ body? : string }> } )?.Records ?? [];
        const refs : Array<{ accountId : string; connectionId : string }> = [];
        for( const record of records )
        {
            try
            {
                const parsed : { accountId? : string; connectionId? : string } = JSON.parse( record.body ?? "{}" );
                if( parsed.accountId && parsed.connectionId ) refs.push( { accountId: parsed.accountId, connectionId: parsed.connectionId } );
            }
            catch { /* skip a malformed record */ }
        }
        return refs;
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Parse the `{ accountId, connectionId, platform, item }` refs out of an SQS Lambda event's
     *  records (`social-inbound`, fed by webhook intake + poll). */
    protected inboundRefs( event : unknown ) : Array<{ accountId : string; connectionId : string; platform : SocialAccount.Platform; item : SocialAdapter.RawInbound }>
    {
        const records : Array<{ body? : string }> = ( event as { Records? : Array<{ body? : string }> } )?.Records ?? [];
        const refs : Array<{ accountId : string; connectionId : string; platform : SocialAccount.Platform; item : SocialAdapter.RawInbound }> = [];
        for( const record of records )
        {
            try
            {
                const parsed : { accountId? : string; connectionId? : string; platform? : SocialAccount.Platform; item? : SocialAdapter.RawInbound } = JSON.parse( record.body ?? "{}" );
                if( parsed.accountId && parsed.connectionId && parsed.platform && parsed.item )
                    refs.push( { accountId: parsed.accountId, connectionId: parsed.connectionId, platform: parsed.platform, item: parsed.item } );
            }
            catch { /* skip a malformed record */ }
        }
        return refs;
    }
}

export default SocialJob;
