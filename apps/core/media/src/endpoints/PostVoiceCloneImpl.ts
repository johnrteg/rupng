//
import { PostVoiceClone, Media } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

// Clone a voice from an account audio asset (media-21) → an account-scoped Media.Voice.
export class PostVoiceCloneImpl extends PostVoiceClone
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        this.service.log.trace( "execute: PostVoiceCloneImpl", { userId: auth.userId, accountId: auth.accountId } );
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const body : PostVoiceClone.Body | null = this.body;
        if( !body?.sourceGuid || !body?.name ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "sourceGuid + name required" } };

        const outcome : { status : number; voice? : Media.Voice } = await this.service.cloneVoice( auth, body.sourceGuid, body.name );
        if( outcome.status === NetworkUtils.Status.CREATED && outcome.voice )
            return { status: NetworkUtils.Status.CREATED, data: { voice: outcome.voice } };

        const message : string =
            outcome.status === NetworkUtils.Status.NOT_FOUND       ? "audio asset not found"
          : outcome.status === NetworkUtils.Status.CONFLICT        ? "voice cloning needs an audio asset"
          : outcome.status === NetworkUtils.Status.NOT_IMPLEMENTED ? "no voice-cloning provider is configured"
          : "could not clone the voice";
        return { status: outcome.status, data: { message } };
    }
}

export default PostVoiceCloneImpl;
