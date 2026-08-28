//
import { PostBrowseImport, Media } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaBrowseService from '../services/MediaBrowseService';

// Import a provider asset into the account library (media-15) — fetch the licensed bytes → normal Media.Asset
// with source.origin = provider → standard scan/process pipeline. Async: returns the created (SCANNING) asset.
export class PostBrowseImportImpl extends PostBrowseImport
{
    private service : MediaBrowseService;
    constructor( service : MediaBrowseService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        this.service.log.trace( "execute: PostBrowseImportImpl", { userId: auth.userId, accountId: auth.accountId } );
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const body : PostBrowseImport.Body | null = this.body;
        if( !body || !body.provider || !body.externalId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "provider + externalId required" } };

        const outcome : { status : number; asset? : Media.Asset } = await this.service.importAsset( auth, body.provider, body.externalId );
        if( outcome.status === NetworkUtils.Status.ACCEPTED && outcome.asset )
            return { status: NetworkUtils.Status.ACCEPTED, data: { asset: outcome.asset } };

        const message : string =
            outcome.status === NetworkUtils.Status.NOT_FOUND   ? "asset not found or no longer available"
          : outcome.status === NetworkUtils.Status.BAD_REQUEST ? "provider not enabled / not configured"
          : "could not import the asset";
        return { status: outcome.status, data: { message } };
    }
}

export default PostBrowseImportImpl;
