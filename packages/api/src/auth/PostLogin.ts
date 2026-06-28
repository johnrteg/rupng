//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

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
export class PostLogin extends RestfulEndpoint<{}, PostLogin.Body, PostLogin.Response>
{
    public readonly uri      : string = PostLogin.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role | undefined = undefined;   // non-authenticated
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;   // edge-reachable, not a published dev API

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
                account:  { type: 'string', minLength: 3 },
                password: { type: 'string', minLength: 1 }
            },
            required: ['account', 'password'],
            additionalProperties: false
        };
    }
}


export namespace PostLogin
{
    export const URI : string = apiPath( "auth", 1, "/login" );   // /api/auth/v1/login

    export interface Body extends RestfulEndpoint.NonAuthRequest
    {
        account  : string;      // email or phone (E.164)
        password : string;
    }

    export interface Response
    {
        complete      : boolean;        // true → fully authenticated; false → a challenge remains
        sessionToken? : string;         // the access token (Bearer) — present when complete
        idToken?      : string;
        refreshToken? : string;
        expiresIn?    : number;         // seconds
        challenge?    : string;         // Cognito challenge name when not complete (e.g. NEW_PASSWORD_REQUIRED)
    }

    // possible error type
    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }

}

export default PostLogin;