//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Voice } from "./model/Voice";

//
// Create an IVR flow (voice-2.1). Server assigns id / audit. Body is the flow's name + entry step id + step
// graph. Validated loosely — the step graph shape is service-owned (the impl checks entryStepId resolves and
// every branch target exists).
//
export class PostVoiceFlow extends RestfulEndpoint< {}, PostVoiceFlow.Body, PostVoiceFlow.Response >
{
    public readonly uri      : string = PostVoiceFlow.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "createVoiceFlow",
        summary:     "Create an IVR flow",
        description: "Creates a saved IVR flow (an entry step id + a step graph: prompt → gather → branch).",
        tags:        [ "Voice" ],
    };

    constructor( body? : PostVoiceFlow.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: true, required: [ "name", "entryStepId", "steps" ],
            properties: {
                name:        { type: "string", minLength: 1 },
                entryStepId: { type: "string", minLength: 1 },
                steps:       { type: "object" },
            },
        };
    }
}

export namespace PostVoiceFlow
{
    export const URI : string = apiPath( "voice", 1, "/flows" );
    export interface Body extends RestfulEndpoint.AuthRequest { name : string; entryStepId : string; steps : Record<string, Voice.IvrStep>; }
    export interface Response extends Voice.IvrFlow {}
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
    }
}

export default PostVoiceFlow;
// eof
