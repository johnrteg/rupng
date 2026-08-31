//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Suspend ONE account's voice dispatch — holds that account's calls on the `WorkQueue` governor (priority 0,
// per-channel) without affecting any other account or channel. A compliance hold / abuse lever; see
// `WorkQueue.suspend`. APPLICATION.
//
export class PostVoiceDispatchSuspend extends RestfulEndpoint< {}, PostVoiceDispatchSuspend.Body, PostVoiceDispatchSuspend.Response >
{
    public readonly uri      : string = PostVoiceDispatchSuspend.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AppRole.APPLICATION;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "suspendVoiceDispatch",
        summary:     "Suspend an account's voice dispatch",
        description: "Holds one account's calls on voice's WorkQueue governor (this channel only) until resumed.",
        tags:        [ "Voice" ],
    };

    constructor( body? : PostVoiceDispatchSuspend.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", additionalProperties: false, required: [ "accountId" ], properties: { accountId: { type: "string" } } };
    }
}

export namespace PostVoiceDispatchSuspend
{
    export const URI : string = apiPath( "voice", 1, "/dispatch/suspend" );
    export interface Body extends RestfulEndpoint.AuthRequest { accountId : string; }
    export interface Response { suspended : true; }
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN    = NetworkUtils.Status.FORBIDDEN,
    }
}

export default PostVoiceDispatchSuspend;
// eof
