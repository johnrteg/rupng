//
import { GetSvgTemplates, SvgTemplate } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';
import SvgService from '../services/SvgService';

// List the system templates + the account's own, optionally filtered by category (summaries only).
export class GetSvgTemplatesImpl extends GetSvgTemplates
{
    private service : MediaService;
    private svg : SvgService;
    constructor( service : MediaService ) { super(); this.service = service; this.svg = new SvgService( service ); }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const category : SvgTemplate.Category | null = this.query?.category ?? null;
        const got : Type.Result<Array<SvgTemplate.Summary>> = await this.svg.getTemplates( auth.accountId, category );
        if( !got.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not list templates" } };

        return { status: NetworkUtils.Status.OK, data: { templates: got.data } };
    }
}

export default GetSvgTemplatesImpl;
