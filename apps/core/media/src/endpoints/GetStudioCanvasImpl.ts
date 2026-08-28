//
import { GetStudioCanvas, StudioProject } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

// Return a project's saved canvas snapshot JSON (null when unsaved). 404 if the project doesn't exist.
export class GetStudioCanvasImpl extends GetStudioCanvas
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        this.service.log.trace( "execute: GetStudioCanvasImpl", { accountId: auth.accountId, id: this.query?.id } );
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const id : string = this.query?.id ?? "";
        if( !id ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "id required" } };

        const project : StudioProject.Entity | undefined = await this.service.getStudioProject( auth.accountId, id );
        if( project === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "project not found" } };

        const canvas : string | null = await this.service.getStudioCanvas( auth.accountId, id );
        return { status: NetworkUtils.Status.OK, data: { canvas } };
    }
}

export default GetStudioCanvasImpl;
