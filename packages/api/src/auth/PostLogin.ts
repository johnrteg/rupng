//
import { RestfulEndpoint, Access } from "@repo/endpoint";
import { Network } from "@repo/common";

/*
    client:
    const endpt : PostLogin = new PostLogin( { account, password } );
    const response : Restful.Response = await appdata.server.fetch( endpt );

    server:
    // register
    server.register( new PostLogin(), callback );

    // respond
    const RestfulEndpoint.Response : resp = await PostLogin.execute( auth );
*/
export class PostLogin extends RestfulEndpoint<{}, PostLogin.Body>
{
    public readonly uri      : string = PostLogin.URI;
    public readonly method   : Network.Method = Network.Method.POST;
    public readonly access   : Access.Role | undefined = undefined;   // non-authenticated
    public readonly timeout  : number | undefined = undefined;
    public readonly exposure : RestfulEndpoint.Exposure = RestfulEndpoint.Exposure.PUBLIC;

    constructor( body? : PostLogin.Body )
    {
        super( {}, body );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        // account & password travel in the JSON body, validated by getBodySchema()
        return [];
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public getQuerySchema(): RestfulEndpoint.Schema | null
    {
        return null;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public getBodySchema(): RestfulEndpoint.SchemaFor<PostLogin.Body> | null
    {
        return {
            type: 'object',
            properties: {
                account:  { type: 'string' },
                password: { type: 'string' }
            },
            required: ['account', 'password'],
            additionalProperties: false
        };
    }
}


export namespace PostLogin
{
    export const URI : string = "/login";

    export interface Body extends RestfulEndpoint.NonAuthRequest
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