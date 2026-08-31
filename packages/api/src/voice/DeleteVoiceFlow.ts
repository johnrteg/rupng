//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Delete an IVR flow (voice-2.1). Hard delete — a flow referenced by an in-flight call is unaffected (the
// call-log row carries its own resolved step state); a NEW call can no longer reference the removed flowId.
//
export class DeleteVoiceFlow extends RestfulEndpoint< DeleteVoiceFlow.Query, undefined, DeleteVoiceFlow.Response >
{
    public readonly uri      : string = DeleteVoiceFlow.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.DELETE;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "deleteVoiceFlow",
        summary:     "Delete an IVR flow",
        description: "Deletes a saved IVR flow.",
        tags:        [ "Voice" ],
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace DeleteVoiceFlow
{
    export const URI : string = apiPath( "voice", 1, "/flows/:id" );
    export interface Query { id : string; }
    export interface Response { deleted : boolean; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND }
}

export default DeleteVoiceFlow;
// eof
