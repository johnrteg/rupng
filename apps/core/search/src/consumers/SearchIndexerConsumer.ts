//
import { Events } from "@repo/system";
import { Access } from "@repo/endpoint";
import { Search as SearchModel } from "@repo/api";
import type { Type } from "@repo/common";

import SearchConsumer from "./SearchConsumer";
import SearchService from "../services/SearchService";

// no payload carries a per-doc access floor today — every v1 doc type (contact/segment/campaign/email)
// is USER-and-above content, so USER is the correct default floor until a type needs something finer.
const DEFAULT_MIN_ACCESS : Access.Role = Access.AccountRole.USER;

//
// SearchIndexerConsumer — the indexer (search-1.x/5.2): subscribes to the 5 v1 searchable-type change
// streams and upserts/removes OpenSearch docs. A genuine `Consumer` (ECS, long-running), NOT a Lambda
// `Job` as SPECS.md originally framed it — see `SearchConsumer.ts`'s header comment for why (no
// Lambda↔Kafka event-source-mapping on this platform; this is `AnalyticsIngestConsumer`'s exact
// precedent). Acts on EVERY event for its subscribed objects (indexes all, drops nothing — search-7.5):
// CREATED/UPDATED upserts, DELETED/PURGED removes (search-5.2's automatic GDPR-forget propagation —
// the index is a projection, so a source purge's normal `*.deleted`/`*.purged` emission is ALL the
// forget mechanism the index needs).
//
export class SearchIndexerConsumer extends SearchConsumer
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor() { super( "indexer" ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    protected async consume() : Promise<void>
    {
        await this.kafka.subscribeEvents( "search-indexer", Events.Object.CONTACT_CONTACT,
            ( event : Events.Of<Events.Object.CONTACT_CONTACT> ) : Promise<void> => this.onContact( event ) );
        await this.kafka.subscribeEvents( "search-indexer", Events.Object.CONTACT_SEGMENT,
            ( event : Events.Of<Events.Object.CONTACT_SEGMENT> ) : Promise<void> => this.onSegment( event ) );
        await this.kafka.subscribeEvents( "search-indexer", Events.Object.CAMPAIGN_CAMPAIGN,
            ( event : Events.Of<Events.Object.CAMPAIGN_CAMPAIGN> ) : Promise<void> => this.onCampaign( event ) );
        await this.kafka.subscribeEvents( "search-indexer", Events.Object.EMAIL_TEMPLATE,
            ( event : Events.Of<Events.Object.EMAIL_TEMPLATE> ) : Promise<void> => this.onEmailTemplate( event ) );
        await this.kafka.subscribeEvents( "search-indexer", Events.Object.EMAIL_MESSAGE,
            ( event : Events.Of<Events.Object.EMAIL_MESSAGE> ) : Promise<void> => this.onEmailMessage( event ) );

        // each subscription runs its own consume loop in the background (kafkajs); block here until a
        // shutdown signal arrives, then let aboutToQuit() disconnect.
        while( !this.isShuttingDown() ) await SearchIndexerConsumer.sleep( 1_000 );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private async onContact( event : Events.Of<Events.Object.CONTACT_CONTACT> ) : Promise<void>
    {
        await this.applyEvent( event.verb, event.target.id, () : SearchModel.IndexDoc => ( {
            id: event.target.id, type: SearchModel.DocType.CONTACT, accountId: event.accountId, minAccess: DEFAULT_MIN_ACCESS,
            title: [ event.data.firstName, event.data.lastName ].filter( ( part : string | undefined ) : boolean => !!part ).join( " " ),
            text: "",   // the slim Payloads.Contact carries no notes/body field to search over yet
            fields: { status: event.data.status },
            updatedAt: event.occurredAt,
        } ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private async onSegment( event : Events.Of<Events.Object.CONTACT_SEGMENT> ) : Promise<void>
    {
        await this.applyEvent( event.verb, event.target.id, () : SearchModel.IndexDoc => ( {
            id: event.target.id, type: SearchModel.DocType.SEGMENT, accountId: event.accountId, minAccess: DEFAULT_MIN_ACCESS,
            title: event.data.name, text: "",
            fields: { status: event.data.status },
            updatedAt: event.occurredAt,
        } ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private async onCampaign( event : Events.Of<Events.Object.CAMPAIGN_CAMPAIGN> ) : Promise<void>
    {
        await this.applyEvent( event.verb, event.target.id, () : SearchModel.IndexDoc => ( {
            id: event.target.id, type: SearchModel.DocType.CAMPAIGN, accountId: event.accountId, minAccess: DEFAULT_MIN_ACCESS,
            title: event.data.name, text: "",
            fields: { status: event.data.status },
            updatedAt: event.occurredAt,
        } ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private async onEmailTemplate( event : Events.Of<Events.Object.EMAIL_TEMPLATE> ) : Promise<void>
    {
        await this.applyEvent( event.verb, event.target.id, () : SearchModel.IndexDoc => ( {
            id: event.target.id, type: SearchModel.DocType.EMAIL, accountId: event.accountId, minAccess: DEFAULT_MIN_ACCESS,
            title: event.data.subject, text: event.data.name,
            fields: { status: event.data.status, kind: "template" },
            updatedAt: event.occurredAt,
        } ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private async onEmailMessage( event : Events.Of<Events.Object.EMAIL_MESSAGE> ) : Promise<void>
    {
        // messages only ever arrive CREATED (see Events.ts's ACCESS map — no updated/deleted verb is
        // registered for this object), so this is always an upsert, never a remove branch.
        await this.applyEvent( event.verb, event.target.id, () : SearchModel.IndexDoc => ( {
            id: event.target.id, type: SearchModel.DocType.EMAIL, accountId: event.accountId, minAccess: DEFAULT_MIN_ACCESS,
            title: event.data.subject, text: event.data.to,
            fields: { status: event.data.status, kind: "message" },
            updatedAt: event.occurredAt,
        } ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Shared upsert/remove branch (search-1.1/5.2) — CREATED/UPDATED indexes the freshly-built doc;
     *  DELETED/PURGED removes it by id. Never throws — a failed write is logged and the offset still
     *  commits (Kafka redelivery would just retry the SAME already-broken write). */
    private async applyEvent( verb : Events.Verb, id : Type.ID, build : () => SearchModel.IndexDoc ) : Promise<void>
    {
        if( verb === Events.Verb.DELETED || verb === Events.Verb.PURGED )
        {
            const removed : Type.Result<void> = await this.search.remove( SearchService.INDEX, id );
            if( !removed.ok ) this.log.error( "indexer: remove failed", { id, error: removed.error } );
            return;
        }

        const doc : SearchModel.IndexDoc = build();
        const indexed : Type.Result<void> = await this.search.index( SearchService.INDEX, doc.id, doc as unknown as Record<string, unknown> );
        if( !indexed.ok ) this.log.error( "indexer: upsert failed", { id: doc.id, type: doc.type, error: indexed.error } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Disconnect Kafka before the process exits — same drain pattern as AnalyticsIngestConsumer. */
    protected async aboutToQuit() : Promise<void>
    {
        try { await this.kafka.disconnect(); } catch( err ) { this.log.error( "kafka disconnect failed", err ); }
        await super.aboutToQuit();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private static sleep( ms : number ) : Promise<void> { return new Promise( ( resolve ) => setTimeout( resolve, ms ) ); }
}

export default SearchIndexerConsumer;
// eof
