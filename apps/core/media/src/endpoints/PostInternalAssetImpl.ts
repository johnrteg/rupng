//
import { PostInternalAsset, Media } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import MediaService from "../services/MediaService";

//
// S2S: store raw bytes as a new media asset (voice-9.0's TTS-cache migration is the first consumer).
//
export class PostInternalAssetImpl extends PostInternalAsset
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const body : PostInternalAsset.Body | null = this.body;
        if( !body || !body.accountId || !body.name || !body.kind || !body.mime || !body.extension || !body.data )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "accountId, name, kind, mime, extension, and data are required" } };

        let bytes : Uint8Array;
        try { bytes = new Uint8Array( Buffer.from( body.data, "base64" ) ); }
        catch { return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "data is not valid base64" } }; }

        const stored : Type.Result<{ asset : Media.Asset; url : string; expiresAt : string }> = await this.service.storeInternalAsset( {
            accountId: body.accountId, name: body.name, kind: body.kind, mime: body.mime, extension: body.extension, bytes, tags: body.tags, source: body.source,
        } );
        if( !stored.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not store the asset" } };
        return { status: NetworkUtils.Status.OK, data: stored.data };
    }
}

export default PostInternalAssetImpl;
// eof
