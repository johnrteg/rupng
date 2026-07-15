//
import { PostSvgFromTemplate } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';
import SvgService from '../services/SvgService';

// Create a new project from a template — copies the template doc + creates the project row.
export class PostSvgFromTemplateImpl extends PostSvgFromTemplate
{
    private service : MediaService;
    private svg : SvgService;
    constructor( service : MediaService ) { super(); this.service = service; this.svg = new SvgService( service ); }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const templateId : string = this.query?.templateId ?? "";
        const body : PostSvgFromTemplate.Body | null = this.body;
        if( !templateId || !body || !body.name ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "templateId and name required" } };

        const created : Type.Result<{ projectId : string }> = await this.svg.createFromTemplate( templateId, auth.accountId, body.name );
        if( !created.ok ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "could not create from template" } };

        return { status: NetworkUtils.Status.OK, data: { projectId: created.data.projectId } };
    }
}

export default PostSvgFromTemplateImpl;
