//
import { PostAssetScan, Media } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

//
// Re-run the malware scan on an asset's ORIGINAL bytes (media-5) — the UI "re-scan" action. Puts the envelope
// back into SCANNING and re-enqueues the media-scan gate; the scan Job (dev drains it in-process, a deploy runs
// MediaScanJob) re-reads the original bytes, records a fresh Media.ScanResult, and quarantines on a detection.
// Async — returns the current asset; the client polls GET /assets/:guid until it settles. Distinct from
// `rescan`, which only re-probes content metadata.
//
export class PostAssetScanImpl extends PostAssetScan
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

        // load the envelope; a deleted asset (or a still-uploading one with no bytes) can't be scanned
        const got : Type.Result<Media.Asset | undefined> = await this.service.dynamo.get<Media.Asset>( "media", { accountId, guid } );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "media read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "media not found" } };

        const asset : Media.Asset = got.data;
        if( asset.status === Media.Status.DELETED || asset.status === Media.Status.UPLOADING )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "asset has no scannable bytes yet" } };

        // put it back into SCANNING (clearing the prior verdict) and re-enqueue the scan gate, which records a
        // fresh Media.ScanResult and advances to processing (clean) or quarantines (threat)
        const now : string = new Date().toISOString();
        const scanning : Media.Asset = { ...asset, status: Media.Status.SCANNING, scanThreat: undefined, scan: undefined, modifiedAt: now };
        const wrote : Type.Result<void> = await this.service.dynamo.put( "media", { ...scanning } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "media write failed" } };

        const queued : Type.Result<void> = await this.service.sqs.send( "media-scan", { accountId, guid } );
        if( !queued.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not start the scan" } };
        void this.service.assetUpdated( scanning, auth.userId );   // media.asset updated (best-effort)

        return { status: NetworkUtils.Status.ACCEPTED, data: { asset: scanning } };
    }
}

export default PostAssetScanImpl;
