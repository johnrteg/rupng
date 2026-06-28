//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Reset password — complete a reset with the emailed/texted code + a new password (meets policy).
//
//   client:
//   const endpt = new PostPasswordReset( { account, code, password } );
//
export class PostPasswordReset extends RestfulEndpoint<{}, PostPasswordReset.Body, PostPasswordReset.Response>
{
    public readonly uri      : string = PostPasswordReset.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role | undefined = undefined;   // non-authenticated (code is the proof)
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( body? : PostPasswordReset.Body )
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
            properties: {
                account:  { type: 'string', minLength: 3 },
                code:     { type: 'string', minLength: 1 },
                password: { type: 'string', minLength: 8 }
            },
            required: ['account', 'code', 'password'],
            additionalProperties: false
        };
    }
}

export namespace PostPasswordReset
{
    export const URI : string = apiPath( "auth", 1, "/password/reset" );   // /api/auth/v1/password/reset

    export interface Body extends RestfulEndpoint.NonAuthRequest
    {
        account  : string;
        code     : string;
        password : string;
    }

    export interface Response
    {
        ok : boolean;
    }

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,   // wrong/expired code
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostPasswordReset;
