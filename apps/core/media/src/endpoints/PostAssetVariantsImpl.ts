//
import { PostAssetVariants, Media, MediaConfig } from '@repo/api';
import { NetworkUtils, ObjectUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

//
// (Re)generate variant profiles for an asset (media-4.6). With a `profile`, validates it against the configured
// set and enqueues the process stage for just that profile. WITHOUT a profile, enqueues EVERY configured
// profile — a full rebuild against the current system config. The shared MediaPipeline derives + merges each
// profile's variants (upsert = replace + version). Async — returns the current asset; the client polls
// GET /assets/:guid/status until the new variants report `ready`. Only a servable (OK) asset can be requested.
//
export class PostAssetVariantsImpl extends PostAssetVariants
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        this.service.log.trace( "execute: PostAssetVariantsImpl", { userId: auth.userId, accountId: auth.accountId, guid: this.query?.guid, profile: this.body?.profile } );
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const guid    : string = this.query?.guid ?? "";
        const profile : string = this.body?.profile ?? "";
        if( !guid )          return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "guid required" } };

        // a named profile must be one the system knows about (media-4.6); no profile = rebuild all configured
        const config : MediaConfig.Config = await this.service.mediaConfig();
        if( profile && !config.variants.profiles[ profile ] )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: `unknown variant profile: ${ profile }` } };

        const got : Type.Result<Media.Asset | undefined> = await this.service.dynamo.get<Media.Asset>( "media", { accountId, guid } );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "media read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "media not found" } };

        const asset : Media.Asset = ObjectUtils.withDefaults( got.data, Media.DEFAULT );
        if( asset.status !== Media.Status.OK )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "asset is not ready for variant generation" } };

        // the profiles to (re)build: the requested one, else EVERY configured profile (full refresh)
        const profiles : Array<string> = profile ? [ profile ] : Object.keys( config.variants.profiles );
        if( profiles.length === 0 )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no variant profiles are configured" } };

        // hand off to the process stage per profile (dev drains the queue in-process; a deploy runs
        // MediaProcessJob) — the shared MediaPipeline derives + merges each profile's variants (upsert).
        for( const target of profiles )
        {
            const queued : Type.Result<void> = await this.service.sqs.send( "media-process", { accountId, guid, profile: target } );
            if( !queued.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not queue variant generation" } };
            this.service.log.trace( "message enqueued (SQS media-process)", { accountId, guid, profile: target } );
        }
        void this.service.assetUpdated( asset, auth.userId );   // media.asset updated (variants requested; best-effort)

        return { status: NetworkUtils.Status.ACCEPTED, data: { asset } };
    }
}

export default PostAssetVariantsImpl;
