//
import { GetMediaUrl, Media, MediaConfig } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';
import { MediaPipeline } from '../pipeline/MediaPipeline';

//
// Resolve an asset (optionally a specific ITEM) to a TIME-LIMITED pre-signed GET URL for preview/download —
// the service decides access + logs (lastAccessedAt), then hands off the URL; it never streams bytes
// (media-2.4). Falls back to the ORIGINAL when the requested item isn't present. (Finer per-object accessRole/
// tier gating beyond the USER endpoint role is a follow-up; CDN delivery for public assets lands w/ CloudFront.)
//
export class GetMediaUrlImpl extends GetMediaUrl
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
        if( !guid )          return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "guid required" } };

        const got : Type.Result<Media.Asset | undefined> = await this.service.dynamo.get<Media.Asset>( "media", { accountId, guid } );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "media read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "media not found" } };

        const asset : Media.Asset = got.data;
        // never hand out bytes for a quarantined (or still-scanning) envelope (media-5) — the scan gate must pass first
        if( asset.status === Media.Status.QUARANTINED ) return { status: NetworkUtils.Status.FORBIDDEN, data: { message: "media failed a malware scan and can't be delivered" } };
        if( asset.status === Media.Status.SCANNING || asset.status === Media.Status.UPLOADING ) return { status: NetworkUtils.Status.FORBIDDEN, data: { message: "media is still being scanned" } };
        const original : Media.Item | undefined = Media.originalItem( asset );
        if( !original ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "media has no original" } };

        // requested item (usage[.profile]) → only when it's an OK item whose bytes ACTUALLY exist in S3, else
        // serve the original. The existence check guards items flagged ready but never written (which would
        // otherwise hand back a URL that 404s with NoSuchKey).
        const wanted : string = this.query?.item ?? "";
        let item : Media.Item = original;
        if( wanted && wanted !== "original" )
        {
            const found : Media.Item | undefined = ( asset.items ?? [] ).find( ( candidate ) => Media.itemKey( candidate.usage, candidate.profile ) === wanted );
            if( found && found.status === Media.Status.OK )
            {
                const present : Type.Result<boolean> = await this.service.s3.exists( "media", MediaPipeline.itemKey( asset, found ) );
                if( present.ok && present.data ) item = found;
            }
        }

        const config : MediaConfig.Config = await this.service.mediaConfig();
        const ttlSec : number = config.delivery.signedUrlTtlSec;
        const signed : Type.Result<string> = await this.service.s3.presignGet( "media", MediaPipeline.itemKey( asset, item ), ttlSec );
        if( !signed.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not presign the download" } };

        // best-effort access log (drives Glacier tiering) — don't fail the request on a write miss
        void this.service.dynamo.put( "media", { ...asset, lastAccessedAt: new Date().toISOString() } );

        return { status: NetworkUtils.Status.OK, data: { url: signed.data, expiresAt: new Date( Date.now() + ttlSec * 1000 ).toISOString() } };
    }
}

export default GetMediaUrlImpl;
