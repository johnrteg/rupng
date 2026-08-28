//
import { DeleteArchive } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

// Delete a download archive — zip bytes (S3) + record (media-20).
export class DeleteArchiveImpl extends DeleteArchive
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        this.service.log.trace( "execute: DeleteArchiveImpl", { userId: auth.userId, accountId: auth.accountId, archiveId: this.query?.archiveId } );
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        if( !this.query.archiveId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "archiveId required" } };
        const deleted : boolean = await this.service.deleteArchive( auth.accountId, this.query.archiveId );
        return { status: NetworkUtils.Status.OK, data: { deleted } };
    }
}

export default DeleteArchiveImpl;
