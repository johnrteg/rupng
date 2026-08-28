//
import { PostAvatar, Media } from '@repo/api';
import { NetworkUtils, ObjectUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

// Set/replace the acting user's avatar (media-23): stamp the framing crop rect on an already-uploaded USER-scope
// image envelope and re-run the media pipeline so it (re)derives the square AVATAR variants (xl→xs). The
// ORIGINAL photo is kept; heavy crop+resize runs in the media-process Job. Returns the asset guid.
export class PostAvatarImpl extends PostAvatar
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        this.service.log.trace( "execute: PostAvatarImpl", { userId: auth.userId, accountId: auth.accountId, guid: this.body?.guid } );
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const guid : string = this.body?.guid ?? "";
        const crop : Media.CropRect | undefined = this.body?.crop;
        if( !guid || crop === undefined ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "guid + crop required" } };

        const got : Type.Result<Media.Asset | undefined> = await this.service.dynamo.get<Media.Asset>( "media", { accountId, guid } );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "media read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "media not found" } };

        // the envelope must be the acting user's OWN avatar (USER scope + their scopeId) and an image
        const current : Media.Asset = ObjectUtils.withDefaults( got.data, Media.DEFAULT );
        if( current.scope !== Media.Scope.USER || current.scopeId !== auth.userId || current.kind !== Media.Kind.IMAGE )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "not the user's avatar image" } };

        // stamp the framing + flip to PROCESSING so the pipeline re-runs and derives the AVATAR variants
        const asset : Media.Asset = { ...current, avatarCrop: crop, status: Media.Status.PROCESSING, modifiedAt: new Date().toISOString() };
        const put : Type.Result<void> = await this.service.dynamo.put( "media", { ...asset } );
        if( !put.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "media write failed" } };

        // enqueue the (re)process — a media Job crops + resizes to the square avatar sizes (best-effort emit)
        const queued : Type.Result<void> = await this.service.sqs.send( "media-process", { accountId, guid } );
        if( queued.ok ) this.service.log.trace( "message enqueued (SQS media-process)", { accountId, guid } );
        void this.service.assetUpdated( asset, auth.userId );
        return { status: NetworkUtils.Status.OK, data: { guid, queued: queued.ok } };
    }
}

export default PostAvatarImpl;
