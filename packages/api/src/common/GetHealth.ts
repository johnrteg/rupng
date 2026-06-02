//
import { Network } from "@repo/common";
import { Endpoint } from "@repo/endpoint";

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
    const Endpoint.Response : resp = await GetHeath.execute( auth );
*/
export class GetHealth extends Endpoint
{
    constructor( request? : GetHealth.Request )
    {
        super( Network.Method.GET, GetHealth.URI );
        this.request = request;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    protected getMappings(): Array<Endpoint.FieldMapping>
    {
        return [ { field : "foo", location: Endpoint.AttrLocation.QUERY_PARAM, required: true, type : "string" } ];
    }



}


export namespace GetHealth
{
    export const URI : string = "/health";

    export interface Request extends Endpoint.NonAuthRequest
    {
        foo : string;
    }

    export interface Response
    {
        ok : boolean;
    }

    // possible error type
    export enum Error
    {
        BAD_REQUEST = Network.Status.BAD_REQUEST,
        INTERNAL_SERVER_ERROR = Network.Status.INTERNAL_SERVER_ERROR,
    }

}

export default GetHealth;