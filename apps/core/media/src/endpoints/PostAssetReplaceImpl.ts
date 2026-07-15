//
import { PostAssetReplace, Media } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';
import { MediaPipeline } from '../pipeline/MediaPipeline';

//
// Replace an existing asset's ORIGINAL bytes in place. Bumps the original item's version, flips the asset back
// to UPLOADING, and presigns a PUT to the SAME S3 key (the versioned bucket keeps the prior bytes). The client
// PUTs the new bytes and then calls PostUploadComplete, which re-runs scan → process and regenerates the
// derived variants from the new original. This is how Studio "Save to Library" updates a composite in place.
//
export class PostAssetReplaceImpl extends PostAssetReplace
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

        const body : PostAssetReplace.Body | null = this.body;
        if( !body || !body.size ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "size required" } };

        // load the asset (must exist + belong to the acting account)
        const got : Type.Result<Media.Asset | undefined> = await this.service.dynamo.get<Media.Asset>( "media", { accountId, guid } );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "media read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "media not found" } };

        const existing : Media.Asset = got.data;
        const original : Media.Item | undefined = Media.originalItem( existing );
        if( original === undefined ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "asset has no original item" } };

        // bump the original item (new version + size + mime), flip the asset to UPLOADING so PostUploadComplete
        // advances it through scan → process again. When the mime changes the format (e.g. PNG → JPEG), the
        // extension — and thus the S3 KEY — changes; otherwise the PUT overwrites the same versioned object.
        const now : string = new Date().toISOString();
        const newMime : string = body.mime ?? original.mime;
        const newExtension : string = this.extensionForMime( newMime, original.extension );
        const updatedOriginal : Media.Item =
        {
            ...original,
            mime:       newMime,
            extension:  newExtension,
            size:       body.size,
            version:    ( original.version ?? 1 ) + 1,
            status:     Media.Status.UPLOADING,
            modifiedAt: now,
        };
        const asset : Media.Asset =
        {
            ...existing,
            status:     Media.Status.UPLOADING,
            modifiedAt: now,
            items:      ( existing.items ?? [] ).map( ( item : Media.Item ) : Media.Item => item.usage === Media.Usage.ORIGINAL ? updatedOriginal : item ),
        };

        const wrote : Type.Result<void> = await this.service.dynamo.put( "media", { ...asset } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "media write failed" } };

        // if the format (extension) changed, the old-key object is now orphaned — drop it (best-effort)
        const oldKey : ReturnType<typeof MediaPipeline.itemKey> = MediaPipeline.itemKey( existing, original );
        const newKey : ReturnType<typeof MediaPipeline.itemKey> = MediaPipeline.itemKey( asset, updatedOriginal );
        if( oldKey !== newKey )
        {
            const removed : Type.Result<void> = await this.service.s3.remove( "media", oldKey );
            if( !removed.ok ) { /* best-effort cleanup; a leftover object is harmless */ }
        }

        // presign a PUT to the (new) original object key
        const config = await this.service.mediaConfig();
        const ttlSec : number = config.upload.presignTtlSec;
        const signed : Type.Result<string> = await this.service.s3.presignPut( "media", MediaPipeline.itemKey( asset, updatedOriginal ), ttlSec );
        if( !signed.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not presign the upload" } };

        const reply : PostAssetReplace.Response =
        {
            asset,
            upload: { url: signed.data, method: "PUT", expiresAt: new Date( Date.now() + ttlSec * 1000 ).toISOString() },
        };
        return { status: NetworkUtils.Status.OK, data: reply };
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    // the file extension (no dot) for a mime — keeps the existing extension when the mime is unrecognized
    private extensionForMime( mime : string, fallback : string ) : string
    {
        if( mime === "image/png" )  return "png";
        if( mime === "image/jpeg" ) return "jpg";
        if( mime === "image/webp" ) return "webp";
        if( mime === "image/svg+xml" ) return "svg";
        return fallback;
    }
}

export default PostAssetReplaceImpl;
