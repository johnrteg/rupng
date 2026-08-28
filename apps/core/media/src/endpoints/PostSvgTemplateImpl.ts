//
import { PostSvgTemplate } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';
import SvgService from '../services/SvgService';

// Save the current project as an account-scoped template — copies the project doc + creates the template row.
export class PostSvgTemplateImpl extends PostSvgTemplate
{
    private service : MediaService;
    private svg : SvgService;
    constructor( service : MediaService ) { super(); this.service = service; this.svg = new SvgService( service ); }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        this.service.log.trace( "execute: PostSvgTemplateImpl", { userId: auth.userId, accountId: auth.accountId } );
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const body : PostSvgTemplate.Body | null = this.body;
        if( !body || !body.projectId || !body.name || !body.category ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "projectId, name and category required" } };

        const saved : Type.Result<{ templateId : string }> = await this.svg.saveAsTemplate( body.projectId, auth.accountId, body.name, body.category, body.tags ?? [] );
        if( !saved.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not save as template" } };

        return { status: NetworkUtils.Status.OK, data: { templateId: saved.data.templateId } };
    }
}

export default PostSvgTemplateImpl;
