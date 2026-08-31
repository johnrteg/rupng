//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Voice } from "./model/Voice";

//
// Update an IVR flow's name / entry step / step graph (voice-2.1). A full-replace PATCH — the impl re-validates
// entryStepId + every branch target against the new step set.
//
export class PatchVoiceFlow extends RestfulEndpoint< PatchVoiceFlow.Query, PatchVoiceFlow.Body, PatchVoiceFlow.Response >
{
    public readonly uri      : string = PatchVoiceFlow.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PATCH;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "updateVoiceFlow",
        summary:     "Update an IVR flow",
        description: "Updates a saved IVR flow's name / entry step / step graph.",
        tags:        [ "Voice" ],
    };

    constructor( id? : string, body? : PatchVoiceFlow.Body ) { super( { id: id ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: true,
            properties: { name: { type: "string" }, entryStepId: { type: "string" }, steps: { type: "object" } },
        };
    }
}

export namespace PatchVoiceFlow
{
    export const URI : string = apiPath( "voice", 1, "/flows/:id" );
    export interface Query { id : string; }
    export interface Body extends RestfulEndpoint.AuthRequest { name? : string; entryStepId? : string; steps? : Record<string, Voice.IvrStep>; }
    export interface Response { flow : Voice.IvrFlow; }
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
    }
}

export default PatchVoiceFlow;
// eof
