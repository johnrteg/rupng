//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Preview one step of a SAVED IVR flow (voice-2.2) — merges `{{ dotted.path }}` tags in the step's message
// with sample data and, for a `"tts"` step, synthesizes it (via the same `AiRouting.Modality.TEXT_TO_SPEECH`
// path a real call uses) so the operator can listen before launching. No call is placed.
//
export class PostVoiceFlowPreview extends RestfulEndpoint< PostVoiceFlowPreview.Query, PostVoiceFlowPreview.Body, PostVoiceFlowPreview.Response >
{
    public readonly uri      : string = PostVoiceFlowPreview.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "previewVoiceFlow",
        summary:     "Preview an IVR flow step",
        description: "Merges sample data into a saved flow's step text and (for TTS) synthesizes a playable preview.",
        tags:        [ "Voice" ],
    };

    constructor( id? : string, body? : PostVoiceFlowPreview.Body ) { super( { id: id ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    { return { type: "object", additionalProperties: true, properties: { stepId: { type: "string" }, mergeData: { type: "object" } } }; }
}

export namespace PostVoiceFlowPreview
{
    export const URI : string = apiPath( "voice", 1, "/flows/:id/preview" );
    export interface Query { id : string; }
    export interface Body extends RestfulEndpoint.AuthRequest { stepId? : string; mergeData? : Record<string, unknown>; }
    export interface Response { text : string; audioUrl? : string; }
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
    }
}

export default PostVoiceFlowPreview;
// eof
