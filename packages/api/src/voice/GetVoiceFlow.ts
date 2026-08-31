//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Voice } from "./model/Voice";

//
// Get a single IVR flow by id (voice-2.1).
//
export class GetVoiceFlow extends RestfulEndpoint< GetVoiceFlow.Query, undefined, GetVoiceFlow.Response >
{
    public readonly uri      : string = GetVoiceFlow.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getVoiceFlow",
        summary:     "Get an IVR flow",
        description: "Fetches a single saved IVR flow by id.",
        tags:        [ "Voice" ],
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetVoiceFlow
{
    export const URI : string = apiPath( "voice", 1, "/flows/:id" );
    export interface Query { id : string; }
    export interface Response { flow : Voice.IvrFlow; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND }
}

export default GetVoiceFlow;
// eof
