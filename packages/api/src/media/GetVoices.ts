//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Media } from "./model/Media";

// The account's cloned voices (media-21) — for the AI Gen voice picker. Account-scoped.
export class GetVoices extends RestfulEndpoint<{}, undefined, GetVoices.Response>
{
    public readonly uri      : string = GetVoices.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor() { super( {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetVoices
{
    export const URI : string = apiPath( "media", 1, "/voices" );
    export interface Response { voices : Array<Media.Voice>; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST }
}

export default GetVoices;
