//
import { PostBrowseSearch, Browse } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaBrowseService from '../services/MediaBrowseService';

// Normalized fan-out search across the selected/enabled providers (media-13). Returns merged results + a
// per-provider status list (a slow/failed provider is reported, not fatal).
export class PostBrowseSearchImpl extends PostBrowseSearch
{
    private service : MediaBrowseService;
    constructor( service : MediaBrowseService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const body : PostBrowseSearch.Body | null = this.body;
        if( !body || !( body.text ?? "" ).trim() ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "search text required" } };

        const query : Browse.Query = { text: body.text.trim(), kinds: body.kinds ?? [], providers: body.providers, page: body.page, cursor: body.cursor, filters: body.filters };
        const outcome : { results : Array<Browse.Result>; providers : Array<Browse.ProviderStatus> } = await this.service.search( query );
        return { status: NetworkUtils.Status.OK, data: { results: outcome.results, providers: outcome.providers } };
    }
}

export default PostBrowseSearchImpl;
