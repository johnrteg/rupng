//
import { DeleteVoice } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

// Remove a cloned voice from the account (media-21).
export class DeleteVoiceImpl extends DeleteVoice
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        this.service.log.trace( "execute: DeleteVoiceImpl", { accountId: auth.accountId, voiceId: this.query?.voiceId } );
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        if( !this.query.voiceId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "voiceId required" } };
        const deleted : boolean = await this.service.deleteVoice( auth.accountId, this.query.voiceId );
        return { status: NetworkUtils.Status.OK, data: { deleted } };
    }
}

export default DeleteVoiceImpl;
