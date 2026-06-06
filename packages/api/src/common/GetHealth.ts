//
import { Network } from "@repo/common";
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
export class GetHealth extends RestfulEndpoint<GetHealth.Query, undefined>
{
    public readonly uri      : string = "/health";
    public readonly method   : Network.Method = Network.Method.GET;
    public readonly access   : Access.Role | undefined = undefined;   // non-authenticated
    public readonly timeout  : number | undefined = undefined;        // default
    public readonly exposure : RestfulEndpoint.Exposure = RestfulEndpoint.Exposure.PUBLIC;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor( query? : GetHealth.Query )
    {
        super( query ?? {}, undefined );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [ { field : "foo", location: RestfulEndpoint.AttrLocation.QUERY_PARAM } ];
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public getQuerySchema(): RestfulEndpoint.SchemaFor<GetHealth.Query> | null
    {
        // foo is optional - a health check must succeed without any input
        return {
            type: 'object',
            properties: { foo: { type: 'string', nullable: true } },
            required: [],
            additionalProperties: false
        };
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
        foo? : string;
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