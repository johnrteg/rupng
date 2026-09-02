//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Voice } from "./model/Voice";

//
// S2S: create an IVR flow (voice-2.1) on behalf of an account — no user session. Same shape as `PostVoiceFlow`
// minus the auth requirement; the caller (e.g. survey's phone/IVR runner compiling a Survey definition —
// survey-2.4) passes `accountId` explicitly, mirroring `PostVoiceCalls`'s S2S pattern. INTERNAL audience.
//
export class PostVoiceInternalFlow extends RestfulEndpoint< {}, PostVoiceInternalFlow.Body, PostVoiceInternalFlow.Response >
{
    public readonly uri      : string = PostVoiceInternalFlow.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : undefined = undefined;   // S2S (INTERNAL audience) — no RBAC role
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.INTERNAL;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "createInternalVoiceFlow",
        summary:     "Create an IVR flow (S2S)",
        description: "Creates a saved IVR flow on behalf of an account — no user session (e.g. a compiled survey definition).",
        tags:        [ "Voice" ],
    };

    constructor( body? : PostVoiceInternalFlow.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: true, required: [ "accountId", "name", "entryStepId", "steps" ],
            properties: {
                accountId:   { type: "string" },
                name:        { type: "string", minLength: 1 },
                entryStepId: { type: "string", minLength: 1 },
                steps:       { type: "object" },
            },
        };
    }
}

export namespace PostVoiceInternalFlow
{
    export const URI : string = apiPath( "voice", 1, "/internal/flows" );
    export interface Body { accountId : string; name : string; entryStepId : string; steps : Record<string, Voice.IvrStep>; }
    export interface Response extends Voice.IvrFlow {}
    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostVoiceInternalFlow;
// eof
