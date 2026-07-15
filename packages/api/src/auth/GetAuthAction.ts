//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { AuthAction } from "./model/AuthAction";

//
// Fetch a pending action by its opaque token (email-2 / actions) — the no-auth LANDING pages call this to
// validate + display an action (is it pending? expired? what type?). Anonymous (the token IS the credential).
//
export class GetAuthAction extends RestfulEndpoint< GetAuthAction.Query, undefined, GetAuthAction.Response >
{
    public readonly uri      : string = GetAuthAction.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role | undefined = undefined;   // non-authenticated (token-gated)
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( token? : string ) { super( { token: token ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "token", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetAuthAction
{
    export const URI : string = apiPath( "auth", 1, "/actions/:token" );
    export interface Query { token : string; }
    export interface Response { action : AuthAction.PublicView; }
    export enum Error { NOT_FOUND = NetworkUtils.Status.NOT_FOUND, GONE = NetworkUtils.Status.GONE }
}

export default GetAuthAction;
// eof
