//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils, type Type } from "@repo/common";

//
// S2S: resolve a FRESH access token for an installation's connection — marketplace owns refresh; the
// caller never sees the raw stored credential, only a token good for immediate use.
//
export class GetInstallationToken extends RestfulEndpoint< GetInstallationToken.Query, undefined, GetInstallationToken.Response >
{
    public readonly uri      : string = GetInstallationToken.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : undefined = undefined;   // S2S (INTERNAL audience) — no RBAC role
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.INTERNAL;

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetInstallationToken
{
    export const URI : string = apiPath( "marketplace", 1, "/internal/installations/:id/token" );

    export interface Query { id : Type.UUID; }

    export interface Response
    {
        accessToken : string;
        expiresAt?  : Type.ISODateTime;
    }

    export enum Error
    {
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetInstallationToken;
