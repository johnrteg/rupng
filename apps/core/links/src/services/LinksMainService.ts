//
import { RequestContext, Sqs } from "@repo/services";
import type { Type } from "@repo/common";
import type { Message } from "@aws-sdk/client-sqs";
import { Links } from "@repo/api";

import LinksService from "./LinksService";

import PostLinksMintImpl from "../endpoints/PostLinksMintImpl";
import PostLinksMintBatchImpl from "../endpoints/PostLinksMintBatchImpl";
import GetLinksCodeQrImpl from "../endpoints/GetLinksCodeQrImpl";
import GetLinksCodeImpl from "../endpoints/GetLinksCodeImpl";
import GetLinksResolveImpl from "../endpoints/GetLinksResolveImpl";
import GetLinksDomainsImpl from "../endpoints/GetLinksDomainsImpl";
import PostLinksDomainImpl from "../endpoints/PostLinksDomainImpl";
import PostLinksDomainVerifyImpl from "../endpoints/PostLinksDomainVerifyImpl";
import DeleteLinksDomainImpl from "../endpoints/DeleteLinksDomainImpl";
import GetLinksAccountDomainsImpl from "../endpoints/GetLinksAccountDomainsImpl";
import PostLinksAccountDomainImpl from "../endpoints/PostLinksAccountDomainImpl";
import DeleteLinksAccountDomainImpl from "../endpoints/DeleteLinksAccountDomainImpl";
import PutLinksAccountDomainDefaultImpl from "../endpoints/PutLinksAccountDomainDefaultImpl";
import PostLinksInternalEraseImpl from "../endpoints/PostLinksInternalEraseImpl";

interface TouchMessage { link : Links.TrackedLink; kind : "clicked" | "scanned"; isBot : boolean; occurredAt : Type.ISODateTime; }

//
// MAIN role — the /links/* API (mint + resolve + domain registry, MVP-combined — see LinksService.ts
// for why the SPECS' Mint/Resolve service split is deferred). Also drains the links-touch queue
// locally (record-then-redirect's async half — same dev-drain posture as print/email/texting).
//
export class LinksMainService extends LinksService
{
    private stopping : boolean = false;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( LinksService.Role.MAIN );
        void this.startTouchConsumer();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    protected override async registerEndpoints() : Promise<void>
    {
        await super.registerEndpoints();   // keeps /health + /version
        this.register( new PostLinksMintImpl( this ) );
        this.register( new PostLinksMintBatchImpl( this ) );
        this.register( new GetLinksCodeQrImpl( this ) );
        this.register( new GetLinksCodeImpl( this ) );
        this.register( new GetLinksResolveImpl( this ) );
        this.register( new GetLinksDomainsImpl( this ) );
        this.register( new PostLinksDomainImpl( this ) );
        this.register( new PostLinksDomainVerifyImpl( this ) );
        this.register( new DeleteLinksDomainImpl( this ) );
        this.register( new GetLinksAccountDomainsImpl( this ) );
        this.register( new PostLinksAccountDomainImpl( this ) );
        this.register( new DeleteLinksAccountDomainImpl( this ) );
        this.register( new PutLinksAccountDomainDefaultImpl( this ) );
        this.register( new PostLinksInternalEraseImpl( this ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // SQS links-touch poll loop (dev drain) — record-then-redirect's async half: build + publish
    // the engagement event off the request path. MAIN drains locally; a Job Lambda in a deploy.
    private async startTouchConsumer() : Promise<void>
    {
        this.log.info( "links touch consumer started (SQS links-touch)" );
        while( !this.stopping )
        {
            try
            {
                const received : Type.Result<Array<Message>> = await this.sqs.receive( "links-touch", 10, 10 );
                if( !received.ok ) { await this.delay( 5000 ); continue; }
                for( const message of received.data )
                    await RequestContext.run( { transactionId: Sqs.transactionId( message ) }, async () : Promise<void> =>
                    {
                        try
                        {
                            const touch = JSON.parse( message.Body ?? "{}" ) as TouchMessage;
                            if( touch.link && touch.kind ) await this.processTouch( touch.link, touch.kind, touch.isBot, touch.occurredAt );
                            if( message.ReceiptHandle ) await this.sqs.delete( "links-touch", message.ReceiptHandle );
                        }
                        catch( err ) { this.log.warn( "touch failed (will redeliver)", { error: String( err ) } ); }
                    } );
            }
            catch( error ) { this.log.warn( "touch receive failed — backing off", { error: String( error ) } ); await this.delay( 5000 ); }
        }
        this.log.info( "links touch consumer stopped" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    protected override async aboutToQuit() : Promise<void>
    {
        this.stopping = true;
        await super.aboutToQuit();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private delay( ms : number ) : Promise<void> { return new Promise( ( resolve ) => setTimeout( resolve, ms ) ); }
}

export default LinksMainService;
// eof
