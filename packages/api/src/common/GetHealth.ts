//
import { NetworkUtils } from "@repo/common";
import { RestfulEndpoint, Access } from "@repo/endpoint";

/*
    client:
    const endpt : GetHealth = new GetHealth( {} );
    const response : Restful.Response = await appdata.server.fetch( endpt );
    if( response.ok )
    {
        const reply : GetHealth.Response = response.data;
    }

    server:
    // register
    server.register( new GetHealth(), callback );

    // respond
    const RestfulEndpoint.Response : resp = await GetHeath.execute( auth );
*/
export class GetHealth extends RestfulEndpoint<GetHealth.Query, undefined, GetHealth.Response>
{
    public readonly uri      : string = "/health";
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role | undefined = undefined;   // non-authenticated
    public readonly timeout  : number | undefined = undefined;        // default
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;   // edge-reachable, not a published dev API

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor( query? : GetHealth.Query )
    {
        super( query ?? {}, undefined );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [];
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public getQuerySchema(): RestfulEndpoint.SchemaFor<GetHealth.Query> | null
    {
        return null;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return null;
    }
}


export namespace GetHealth
{
    export interface Query extends RestfulEndpoint.NonAuthRequest
    {
    }

    export interface Response
    {
        ok : boolean;
        version : string;
    }

    // possible error type
    export enum Error
    {
        BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }

}

export default GetHealth;