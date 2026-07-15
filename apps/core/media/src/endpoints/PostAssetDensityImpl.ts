//
import { PostAssetDensity, Media, MediaConfig } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

//
// Render an image to a configured DPI/density (media-4) — ENQUEUES the density job (media-process carries a
// `density` marker; the shared MediaPipeline.densify does the sharp render + adds a `density.<target>` item).
// Async (image transforms can exceed 500ms → always a job): returns 202 with the current envelope; the client
// polls until the new item is ready. Image originals only.
//
export class PostAssetDensityImpl extends PostAssetDensity
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const guid : string = this.query?.guid ?? "";
        const densityKey : string = this.body?.density ?? "";
        if( !guid || !densityKey ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "guid and density required" } };

        // the density target must be one the system knows about (media-4)
        const config : MediaConfig.Config = await this.service.mediaConfig();
        if( !( config.densities ?? {} )[ densityKey ] ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: `unknown density: ${ densityKey }` } };

        const got : Type.Result<Media.Asset | undefined> = await this.service.dynamo.get<Media.Asset>( "media", { accountId, guid } );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "media read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "media not found" } };

        const asset : Media.Asset = got.data;
        const original : Media.Item | undefined = Media.originalItem( asset );
        if( !original || original.kind !== Media.Kind.IMAGE ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "density applies to images only" } };
        if( asset.status !== Media.Status.OK ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "asset is not ready" } };

        // hand off to the process stage carrying the density target (dev drains the queue in-process; a deploy
        // runs MediaProcessJob) — MediaPipeline.densify renders + merges the density item
        const queued : Type.Result<void> = await this.service.sqs.send( "media-process", { accountId, guid, density: densityKey } );
        if( !queued.ok ) { this.service.log.warn( "density enqueue failed — media-process queue send", { guid, densityKey, error: queued.error } ); return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not queue the density render" } }; }
        void this.service.assetUpdated( asset, auth.userId );   // media.asset updated (density requested; best-effort)

        return { status: NetworkUtils.Status.ACCEPTED, data: { asset } };
    }
}

export default PostAssetDensityImpl;
