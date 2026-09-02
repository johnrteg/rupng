//
import { RequestContext, Sqs } from "@repo/services";
import type { Type } from "@repo/common";
import type { Message } from "@aws-sdk/client-sqs";
import { Segment } from "@repo/api";

import ContactService from "./ContactService";

import GetContactsImpl from "../endpoints/GetContactsImpl";
import GetInternalContactsImpl from "../endpoints/GetInternalContactsImpl";
import GetInternalContactByIdentifierImpl from "../endpoints/GetInternalContactByIdentifierImpl";
import PostInternalContactUpdateImpl from "../endpoints/PostInternalContactUpdateImpl";
import PostContactForgetImpl from "../endpoints/PostContactForgetImpl";
import GetContactImpl from "../endpoints/GetContactImpl";
import PostContactImpl from "../endpoints/PostContactImpl";
import PatchContactImpl from "../endpoints/PatchContactImpl";
import DeleteContactImpl from "../endpoints/DeleteContactImpl";
import GetSegmentsImpl from "../endpoints/GetSegmentsImpl";
import PostSegmentImpl from "../endpoints/PostSegmentImpl";
import PostSegmentPreviewImpl from "../endpoints/PostSegmentPreviewImpl";
import PostSegmentRefreshImpl from "../endpoints/PostSegmentRefreshImpl";
import PostSegmentResetImpl from "../endpoints/PostSegmentResetImpl";
import PostSegmentCopyImpl from "../endpoints/PostSegmentCopyImpl";
import GetSegmentRunsImpl from "../endpoints/GetSegmentRunsImpl";
import PatchSegmentImpl from "../endpoints/PatchSegmentImpl";
import DeleteSegmentImpl from "../endpoints/DeleteSegmentImpl";
import GetSegmentMembersImpl from "../endpoints/GetSegmentMembersImpl";
import PostSegmentMembersImpl from "../endpoints/PostSegmentMembersImpl";
import DeleteSegmentMemberImpl from "../endpoints/DeleteSegmentMemberImpl";
import GetContactSegmentsImpl from "../endpoints/GetContactSegmentsImpl";
import GetContactFieldsImpl from "../endpoints/GetContactFieldsImpl";
import PostContactFieldImpl from "../endpoints/PostContactFieldImpl";
import PatchContactFieldImpl from "../endpoints/PatchContactFieldImpl";
import DeleteContactFieldImpl from "../endpoints/DeleteContactFieldImpl";
import GetImportMapsImpl from "../endpoints/GetImportMapsImpl";
import GetImportMapImpl from "../endpoints/GetImportMapImpl";
import PostImportMapImpl from "../endpoints/PostImportMapImpl";
import PatchImportMapImpl from "../endpoints/PatchImportMapImpl";
import DeleteImportMapImpl from "../endpoints/DeleteImportMapImpl";
import PostImportMapCopyImpl from "../endpoints/PostImportMapCopyImpl";

//
// MAIN role — the /contact/* API (contact + segment CRUD). Single deployable role for the contact service.
//
export class ContactMainService extends ContactService
{
    private stopping : boolean = false;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( ContactService.Role.MAIN );
        void this.startSegmentRefreshConsumer();
        void this.startSegmentMaterializeConsumer();
        void this.startForgetConsumer();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // SQS contact-segment-refresh poll loop (dev drain) — recompute the reachability counts of the segments a
    // changed contact belongs to, off the request path. MAIN drains locally; a Job Lambda in a deploy.
    private async startSegmentRefreshConsumer() : Promise<void>
    {
        this.log.info( "contact segment-refresh consumer started (SQS contact-segment-refresh)" );
        while( !this.stopping )
        {
            try
            {
                const received : Type.Result<Array<Message>> = await this.sqs.receive( "contact-segment-refresh", 10, 10 );
                if( !received.ok ) { await this.delay( 5000 ); continue; }
                for( const message of received.data )
                    await RequestContext.run( { transactionId: Sqs.transactionId( message ) }, async () : Promise<void> =>
                    {
                        try
                        {
                            const req = JSON.parse( message.Body ?? "{}" ) as { accountId? : string; contactId? : string };
                            if( req.accountId && req.contactId ) await this.refreshContactSegments( req.accountId, req.contactId );
                            if( message.ReceiptHandle ) await this.sqs.delete( "contact-segment-refresh", message.ReceiptHandle );
                        }
                        catch( err ) { this.log.warn( "segment-refresh failed (will redeliver)", { error: String( err ) } ); }
                    } );
            }
            catch( error ) { this.log.warn( "segment-refresh receive failed — backing off", { error: String( error ) } ); await this.delay( 5000 ); }
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // SQS contact-segment-materialize poll loop (dev drain) — (re)derive a segment's QUERY membership from its
    // saved filter, off the request path. MAIN drains locally; a Job Lambda in a deploy.
    private async startSegmentMaterializeConsumer() : Promise<void>
    {
        this.log.info( "contact segment-materialize consumer started (SQS contact-segment-materialize)" );
        while( !this.stopping )
        {
            try
            {
                const received : Type.Result<Array<Message>> = await this.sqs.receive( "contact-segment-materialize", 10, 10 );
                if( !received.ok ) { await this.delay( 5000 ); continue; }
                for( const message of received.data )
                    await RequestContext.run( { transactionId: Sqs.transactionId( message ) }, async () : Promise<void> =>
                    {
                        try
                        {
                            const req = JSON.parse( message.Body ?? "{}" ) as { accountId? : string; segmentId? : string; trigger? : Segment.RunTrigger; actorUserId? : string };
                            if( req.accountId && req.segmentId ) await this.materializeSegment( req.accountId, req.segmentId, req.trigger, req.actorUserId );
                            if( message.ReceiptHandle ) await this.sqs.delete( "contact-segment-materialize", message.ReceiptHandle );
                        }
                        catch( err ) { this.log.warn( "segment-materialize failed (will redeliver)", { error: String( err ) } ); }
                    } );
            }
            catch( error ) { this.log.warn( "segment-materialize receive failed — backing off", { error: String( error ) } ); await this.delay( 5000 ); }
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // SQS contact-forget poll loop (dev drain) — redact + fan-out + PURGED emit, off the request path.
    // MAIN drains locally; a Job Lambda in a deploy.
    private async startForgetConsumer() : Promise<void>
    {
        this.log.info( "contact forget consumer started (SQS contact-forget)" );
        while( !this.stopping )
        {
            try
            {
                const received : Type.Result<Array<Message>> = await this.sqs.receive( "contact-forget", 10, 10 );
                if( !received.ok ) { await this.delay( 5000 ); continue; }
                for( const message of received.data )
                    await RequestContext.run( { transactionId: Sqs.transactionId( message ) }, async () : Promise<void> =>
                    {
                        try
                        {
                            const req = JSON.parse( message.Body ?? "{}" ) as { accountId? : string; contactId? : string; actorUserId? : string; reason? : string };
                            if( req.accountId && req.contactId && req.actorUserId ) await this.processForget( req.accountId, req.contactId, req.actorUserId, req.reason );
                            if( message.ReceiptHandle ) await this.sqs.delete( "contact-forget", message.ReceiptHandle );
                        }
                        catch( err ) { this.log.warn( "forget failed (will redeliver)", { error: String( err ) } ); }
                    } );
            }
            catch( error ) { this.log.warn( "forget receive failed — backing off", { error: String( error ) } ); await this.delay( 5000 ); }
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Stop the poll loop before the base closes the HTTP server (so the process can exit on SIGINT). */
    protected override async aboutToQuit() : Promise<void>
    {
        this.stopping = true;
        await super.aboutToQuit();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private delay( ms : number ) : Promise<void> { return new Promise( ( resolve ) => setTimeout( resolve, ms ) ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Register the contact endpoint impls (after the inherited /health + /version). */
    protected override async registerEndpoints() : Promise<void>
    {
        await super.registerEndpoints();          // keeps /health + /version
        this.register( new GetContactsImpl( this ) );
        this.register( new GetInternalContactsImpl( this ) );
        this.register( new GetInternalContactByIdentifierImpl( this ) );
        this.register( new PostInternalContactUpdateImpl( this ) );
        this.register( new PostContactForgetImpl( this ) );
        this.register( new GetContactImpl( this ) );
        this.register( new PostContactImpl( this ) );
        this.register( new PatchContactImpl( this ) );
        this.register( new DeleteContactImpl( this ) );
        this.register( new GetSegmentsImpl( this ) );
        this.register( new PostSegmentImpl( this ) );
        this.register( new PostSegmentPreviewImpl( this ) );
        this.register( new PostSegmentRefreshImpl( this ) );
        this.register( new PostSegmentResetImpl( this ) );
        this.register( new PostSegmentCopyImpl( this ) );
        this.register( new GetSegmentRunsImpl( this ) );
        this.register( new PatchSegmentImpl( this ) );
        this.register( new DeleteSegmentImpl( this ) );
        this.register( new GetSegmentMembersImpl( this ) );
        this.register( new PostSegmentMembersImpl( this ) );
        this.register( new DeleteSegmentMemberImpl( this ) );
        this.register( new GetContactSegmentsImpl( this ) );
        this.register( new GetContactFieldsImpl( this ) );
        this.register( new PostContactFieldImpl( this ) );
        this.register( new PatchContactFieldImpl( this ) );
        this.register( new DeleteContactFieldImpl( this ) );
        this.register( new GetImportMapsImpl( this ) );
        this.register( new GetImportMapImpl( this ) );
        this.register( new PostImportMapImpl( this ) );
        this.register( new PatchImportMapImpl( this ) );
        this.register( new DeleteImportMapImpl( this ) );
        this.register( new PostImportMapCopyImpl( this ) );
    }
}

export default ContactMainService;
