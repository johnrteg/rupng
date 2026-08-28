//
import { GetStudioProjects, StudioProject } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

// List the acting account's Studio projects (the project tree).
export class GetStudioProjectsImpl extends GetStudioProjects
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        this.service.log.trace( "execute: GetStudioProjectsImpl", { accountId: auth.accountId } );
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const records : Array<StudioProject.Entity> = await this.service.listStudioProjects( auth.accountId );
        return { status: NetworkUtils.Status.OK, data: { records } };
    }
}

export default GetStudioProjectsImpl;
