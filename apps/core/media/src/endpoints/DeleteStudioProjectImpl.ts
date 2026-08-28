//
import { DeleteStudioProject } from '@repo/api';
import { NetworkUtils, type Type } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

// Soft-delete a Studio project (marks it deleted; record + its stored canvas snapshot are KEPT so a mistaken
// delete stays recoverable). Library assets it saved to are untouched.
export class DeleteStudioProjectImpl extends DeleteStudioProject
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        this.service.log.trace( "execute: DeleteStudioProjectImpl", { userId: auth.userId, accountId: auth.accountId, id: this.query?.id } );
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const id : string = this.query?.id ?? "";
        if( !id ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "id required" } };

        const removed : Type.Result<void> = await this.service.removeStudioProject( auth.accountId, id );
        if( !removed.ok ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "project not found" } };

        return { status: NetworkUtils.Status.OK, data: { deleted: true } };
    }
}

export default DeleteStudioProjectImpl;
