//
import { DeleteStudioProject } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

// Delete a Studio project (record + its stored canvas snapshot). Library assets it saved to are untouched.
export class DeleteStudioProjectImpl extends DeleteStudioProject
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const id : string = this.query?.id ?? "";
        if( !id ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "id required" } };

        const removed : Type.Result<void> = await this.service.removeStudioProject( auth.accountId, id );
        if( !removed.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not delete the project" } };

        return { status: NetworkUtils.Status.OK, data: { deleted: true } };
    }
}

export default DeleteStudioProjectImpl;
