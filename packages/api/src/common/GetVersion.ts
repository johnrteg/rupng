//
import { NetworkUtils } from "@repo/common";
import { RestfulEndpoint, Access } from "@repo/endpoint";

/*
    A tiny, unauthenticated endpoint that reports the running service's id + version. Audience PUBLIC
    so it is reachable at the API Gateway edge (exposure derives from audience) — the deploy console
    discovers each service's gateway and reads /version to show what's actually live per environment.

    client:
    const endpt : GetVersion = new GetVersion( {} );
    const response = await appdata.server.fetch( endpt );
    if( response.ok ) { const reply : GetVersion.Response = response.data; }
*/
export class GetVersion extends RestfulEndpoint<GetVersion.Query, undefined, GetVersion.Response>
{
    public readonly uri      : string = "/version";
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role | undefined = undefined;   // non-authenticated
    public readonly timeout  : number | undefined = undefined;        // default
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;   // edge-reachable + published

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor( query? : GetVersion.Query )
    {
        super( query ?? {}, undefined );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [];
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public getQuerySchema(): RestfulEndpoint.SchemaFor<GetVersion.Query> | null
    {
        return null;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return null;
    }
}


export namespace GetVersion
{
    export interface Query extends RestfulEndpoint.NonAuthRequest
    {
    }

    export interface Response
    {
        /** Canonical service id (e.g. "app"). */
        service : string;
        /** package.json version of the running service. */
        version : string;
    }

    // possible error type
    export enum Error
    {
        BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }

}

export default GetVersion;
