//
import { SocialAccount, SocialInbound } from "@repo/api";
import { Dynamo, Trace } from "@repo/services";
import type { Type } from "@repo/common";

import { SocialAdapter } from "../adapters/SocialAdapter";

//
// InboundPipeline — normalizes a platform's raw inbound item into a `SocialInbound.Entity`: cheap
// keyword tagging + sentiment scoring (SPECS.md §5.4 — "rides the cheap keyword score"; a real model
// is analytics' call, not social's), then stores it. Shared by both inbound sources — the webhook
// intake (Meta push, `SocialInboundJob` fed by `SocialWebhookService`) and the poll path (`SocialPollJob`,
// X/TikTok/LinkedIn) — so normalize/tag/score logic lives in exactly one place.
//
export namespace InboundPipeline
{
    export interface Deps { dynamo : Dynamo; log : Trace; }

    // very small keyword buckets — a first-line filter, not a moderation model (see header note)
    const GOOD_WORDS : Array<string> = [ "love", "great", "amazing", "thank", "awesome", "excellent" ];
    const BAD_WORDS  : Array<string> = [ "hate", "terrible", "worst", "awful", "disappointed", "refund" ];
    const RUDE_WORDS : Array<string> = [ "stupid", "idiot", "shut up", "trash" ];
    const SPAM_WORDS : Array<string> = [ "http://", "https://", "buy now", "click here", "free money" ];

    const RETENTION_DAYS : number = 90;   // TTL — inbound isn't kept forever (SPECS.md's data model note)

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Normalize one raw inbound item + persist it. Idempotent: `id` reuses the platform's own
     *  `externalId` as the dedupe key (not a generated UUID) so a poll sweep or webhook redelivery
     *  overwriting the same item is a no-op, not a duplicate row. */
    export async function ingest(
        deps : Deps, accountId : Type.UUID, connectionId : Type.UUID, platform : SocialAccount.Platform, raw : SocialAdapter.RawInbound,
    ) : Promise<Type.Result<void>>
    {
        const tags : Array<SocialInbound.Tag> = tag( raw.text );
        const sentiment : SocialInbound.Sentiment = score( raw.text );
        const receivedAt : Type.ISODateTime = raw.occurredAt;
        const ttl : number = Math.floor( Date.now() / 1000 ) + RETENTION_DAYS * 24 * 60 * 60;

        const entity : SocialInbound.Entity =
        {
            id: raw.externalId,
            accountId,
            connectionId,
            type: raw.type,
            platform,
            authorHandle: raw.authorHandle,
            text: raw.text,
            rating: raw.rating,
            tags,
            sentiment,
            status: SocialInbound.Status.OPEN,
            receivedAt,
            ttl,
        };

        const wrote : Type.Result<void> = await deps.dynamo.put( "inbox", { ...entity } );
        if( !wrote.ok ) deps.log.warn( "inbound ingest write failed", { accountId, connectionId, externalId: raw.externalId, error: wrote.error } );
        return wrote;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    function tag( text : string ) : Array<SocialInbound.Tag>
    {
        const lower : string = text.toLowerCase();
        const tags : Array<SocialInbound.Tag> = [];
        if( GOOD_WORDS.some( ( word : string ) : boolean => lower.includes( word ) ) ) tags.push( SocialInbound.Tag.GOOD );
        if( BAD_WORDS.some(  ( word : string ) : boolean => lower.includes( word ) ) ) tags.push( SocialInbound.Tag.BAD );
        if( RUDE_WORDS.some( ( word : string ) : boolean => lower.includes( word ) ) ) tags.push( SocialInbound.Tag.RUDE );
        if( SPAM_WORDS.some( ( word : string ) : boolean => lower.includes( word ) ) ) tags.push( SocialInbound.Tag.SPAM );
        if( lower.includes( "?" ) ) tags.push( SocialInbound.Tag.QUESTION );
        return tags;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    function score( text : string ) : SocialInbound.Sentiment
    {
        const lower : string = text.toLowerCase();
        const good : number = GOOD_WORDS.filter( ( word : string ) : boolean => lower.includes( word ) ).length;
        const bad  : number = BAD_WORDS.filter(  ( word : string ) : boolean => lower.includes( word ) ).length + RUDE_WORDS.filter( ( word : string ) : boolean => lower.includes( word ) ).length;
        if( good > bad )  return SocialInbound.Sentiment.POSITIVE;
        if( bad  > good ) return SocialInbound.Sentiment.NEGATIVE;
        return SocialInbound.Sentiment.NEUTRAL;
    }
}

export default InboundPipeline;
