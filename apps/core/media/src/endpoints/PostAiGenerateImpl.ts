//
import { PostAiGenerate, AiGen } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

// Generate a new asset from a prompt (media-18) — resolve the modality's provider (config/ai routing or the
// request override), call the AI factory, save the bytes as a source.origin = generated Media.Asset, and
// return a preview. 501 when no provider/adapter serves the modality (the UI shows "unavailable").
export class PostAiGenerateImpl extends PostAiGenerate
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        this.service.log.trace( "execute: PostAiGenerateImpl", { userId: auth.userId, accountId: auth.accountId } );
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const body : PostAiGenerate.Body | null = this.body;
        if( !body || !body.modality || !body.prompt || body.prompt.trim() === "" )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "modality + prompt required" } };

        const request : AiGen.Request = { modality: body.modality, prompt: body.prompt, provider: body.provider, model: body.model, params: body.params, count: body.count };
        const outcome : { status : number; response? : AiGen.Response } = await this.service.enqueueGenerate( auth, request );
        if( outcome.status === NetworkUtils.Status.ACCEPTED && outcome.response )
            return { status: NetworkUtils.Status.ACCEPTED, data: outcome.response };

        const message : string =
            outcome.status === NetworkUtils.Status.NOT_IMPLEMENTED ? "no AI provider is configured for that media type"
          : "could not start the generation";
        return { status: outcome.status, data: { message } };
    }
}

export default PostAiGenerateImpl;
