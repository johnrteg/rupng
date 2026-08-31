//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Resume ONE account's voice dispatch, undoing a prior `PostVoiceDispatchSuspend`. See `WorkQueue.resume`.
// APPLICATION.
//
export class PostVoiceDispatchResume extends RestfulEndpoint< {}, PostVoiceDispatchResume.Body, PostVoiceDispatchResume.Response >
{
    public readonly uri      : string = PostVoiceDispatchResume.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AppRole.APPLICATION;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "resumeVoiceDispatch",
        summary:     "Resume an account's voice dispatch",
        description: "Undoes a prior suspend of one account's calls on voice's WorkQueue governor (this channel only).",
        tags:        [ "Voice" ],
    };

    constructor( body? : PostVoiceDispatchResume.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", additionalProperties: false, required: [ "accountId" ], properties: { accountId: { type: "string" } } };
    }
}

export namespace PostVoiceDispatchResume
{
    export const URI : string = apiPath( "voice", 1, "/dispatch/resume" );
    export interface Body extends RestfulEndpoint.AuthRequest { accountId : string; }
    export interface Response { suspended : false; }
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN    = NetworkUtils.Status.FORBIDDEN,
    }
}

export default PostVoiceDispatchResume;
// eof
