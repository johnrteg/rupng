//
import { Endpoint } from "@repo/endpoint";
import { Network } from "@repo/common";

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
export class PostLogin extends Endpoint
{
    protected request? : PostLogin.Request;

    constructor( request? : PostLogin.Request )
    {
        super( Network.Method.POST, PostLogin.URI );
        this.request = request;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    protected getMappings(): Array<Endpoint.FieldMapping>
    {
        return [ { field : "account", location: Endpoint.AttrLocation.BODY, required: true, type : "string" },
                 { field : "password", location: Endpoint.AttrLocation.BODY, required: true, type : "string" }
                ];
    }

}


export namespace PostLogin
{
    export const URI : string = "/login";

    export interface Request extends Endpoint.NonAuthRequest
    {
        account : string;
        password : string;
    }

    export interface Response
    {
    }

    // possible error type
    export enum Error
    {
        BAD_REQUEST = Network.Status.BAD_REQUEST,
        INTERNAL_SERVER_ERROR = Network.Status.INTERNAL_SERVER_ERROR,
    }

}

export default PostLogin;