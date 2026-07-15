//
import { GetArticle } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AppService from '../services/AppService';

//
// STUB — help-center article fetch. Returns "coming soon…" until the help-center (Zendesk) integration lands.
// TODO: fetch the article by id from the help-center source (cache locally) and map it to GetArticle.Article.
//
export class GetArticleImpl extends GetArticle
{
    private service : AppService;
    constructor( service : AppService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const reply : GetArticle.Response = { message: "coming soon…" };
        return { status: NetworkUtils.Status.OK, data: reply };
    }
}

export default GetArticleImpl;
