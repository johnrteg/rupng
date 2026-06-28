//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Forgot password — start a reset for an identifier (Cognito emails/texts a code). Enumeration-neutral:
// the response is the same whether or not the account exists.
//
//   client:
//   const endpt = new PostPasswordForgot( { account } );
//
export class PostPasswordForgot extends RestfulEndpoint<{}, PostPasswordForgot.Body, PostPasswordForgot.Response>
{
    public readonly uri      : string = PostPasswordForgot.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role | undefined = undefined;   // non-authenticated
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( body? : PostPasswordForgot.Body )
    {
        super( {}, body );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }

    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: 'object',
            properties: { account: { type: 'string', minLength: 3 } },
            required: ['account'],
            additionalProperties: false
        };
    }
}

export namespace PostPasswordForgot
{
    export const URI : string = apiPath( "auth", 1, "/password/forgot" );   // /api/auth/v1/password/forgot

    export interface Body extends RestfulEndpoint.NonAuthRequest
    {
        account : string;   // email or phone (E.164)
    }

    export interface Response
    {
        sent : boolean;     // always true (enumeration-neutral)
    }

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        TOO_MANY_REQUESTS     = NetworkUtils.Status.TOO_MANY_REQUESTS,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostPasswordForgot;
