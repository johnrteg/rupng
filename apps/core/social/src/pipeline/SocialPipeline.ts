//
import { SocialAccount, SocialPost } from "@repo/api";
import { Dynamo, Sqs, Kafka, Events, Trace } from "@repo/services";
import type { Type } from "@repo/common";

import { MarketplaceClient } from "../clients/MarketplaceClient";
import { AdapterFactory } from "../adapters/AdapterFactory";
import { SocialAdapter } from "../adapters/SocialAdapter";

//
// SocialPipeline — the publish processing shared by both runtimes (`SocialMainService` drains the
// queue locally for dev; `SocialPublishWorker` runs the same steps as a real Lambda). Mirrors media's
// `MediaPipeline` — the domain logic lives here once, not duplicated per runtime.
//
export namespace SocialPipeline
{
    /** Facades the pipeline needs — supplied by `SocialService` (dev consumers) or `SocialJob`. */
    export interface Deps
    {
        dynamo      : Dynamo;
        sqs         : Sqs;
        kafka       : Kafka;
        log         : Trace;
        marketplace : MarketplaceClient;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Publish every target of a post: resolve its connection + a fresh marketplace token, render +
     *  publish via the platform's adapter, record a `PublishedPost` row per target, then roll the
     *  post's own status up to PUBLISHED (all targets ok) or FAILED (any target failed). */
    export async function publishPost( deps : Deps, accountId : Type.UUID, postId : Type.UUID ) : Promise<void>
    {
        const got : Type.Result<SocialPost.Entity | undefined> = await deps.dynamo.get<SocialPost.Entity>( "posts", { accountId, id: postId } );
        if( !got.ok || !got.data ) { deps.log.warn( "publish: post not found", { postId } ); return; }
        const post : SocialPost.Entity = got.data;

        let anyFailed : boolean = false;
        for( const target of post.targets )
        {
            const outcome : SocialPost.PublishOutcome = await publishTarget( deps, accountId, post, target );
            if( outcome === SocialPost.PublishOutcome.FAILED ) anyFailed = true;
        }

        const now : Type.ISODateTime = new Date().toISOString();
        const status : SocialPost.Status = anyFailed ? SocialPost.Status.FAILED : SocialPost.Status.PUBLISHED;
        const wrote : Type.Result<void> = await deps.dynamo.put( "posts", { ...post, status, modifiedAt: now } );
        if( !wrote.ok ) { deps.log.warn( "publish: post status update failed", { postId } ); return; }

        const published : Type.Result<void> = await deps.kafka.publishEvent( Events.envelope( {
            object: Events.Object.SOCIAL_POST, verb: Events.Verb.UPDATED, accountId,
            target: { type: "social.post", id: postId },
            data:   { id: postId, accountId, status, targetCount: post.targets.length },
        } ) );
        if( !published.ok ) deps.log.warn( "social.post event publish failed", { postId, error: published.error } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Publish one target and write its `PublishedPost` result row. Never throws — every failure mode
     *  (missing connection, token resolution, unsupported platform, adapter error) is captured onto
     *  the result row so the caller can roll the post's overall status up from per-target outcomes. */
    async function publishTarget( deps : Deps, accountId : Type.UUID, post : SocialPost.Entity, target : SocialPost.PostTarget ) : Promise<SocialPost.PublishOutcome>
    {
        const now : Type.ISODateTime = new Date().toISOString();
        const fail = async ( error : string ) : Promise<SocialPost.PublishOutcome> =>
        {
            await deps.dynamo.put( "published_posts", {
                postId: post.id, target: `${ target.platform }#${ target.connectionId }`,
                platform: target.platform, connectionId: target.connectionId,
                status: SocialPost.PublishOutcome.FAILED, error, publishedAt: now,
            } );
            return SocialPost.PublishOutcome.FAILED;
        };

        const connection : Type.Result<SocialAccount.Entity | undefined> = await deps.dynamo.get<SocialAccount.Entity>( "connections", { accountId, id: target.connectionId } );
        if( !connection.ok || !connection.data ) return fail( "connection not found" );

        const adapter : SocialAdapter | undefined = AdapterFactory.for( target.platform );
        if( !adapter ) return fail( `no adapter registered for platform ${ target.platform }` );

        const token : Type.Result<{ accessToken : string }> = await deps.marketplace.token( connection.data.marketplaceInstallationId );
        if( !token.ok ) return fail( "marketplace token resolution failed" );

        const rendition : SocialPost.Rendition = adapter.render( post, target );
        const published : Type.Result<SocialAdapter.PublishResult> = await adapter.publish( rendition, token.data.accessToken );
        if( !published.ok ) return fail( published.error );

        const wrote : Type.Result<void> = await deps.dynamo.put( "published_posts", {
            postId: post.id, target: `${ target.platform }#${ target.connectionId }`,
            platform: target.platform, connectionId: target.connectionId,
            platformPostId: published.data.platformPostId, status: SocialPost.PublishOutcome.PUBLISHED, publishedAt: now,
        } );
        if( !wrote.ok ) { deps.log.warn( "publish: PublishedPost write failed", { postId: post.id, target } ); return SocialPost.PublishOutcome.FAILED; }

        return SocialPost.PublishOutcome.PUBLISHED;
    }
}

export default SocialPipeline;
