//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Existence check — does a user already exist for this email and/or phone? Pass either or both.
//
// ⚠️ ENUMERATION-NEUTRALITY: this is an **authenticated admin/staff** lookup, NOT an anonymous
// pre-auth surface. The public sign-up path must NOT call it — registration stays enumeration-neutral
// (POST /auth/register acknowledges the same way regardless and emails the real owner out-of-band).
// See apps/core/auth/specs/ACCESS-FLOWS.md → "Security posture".
//
//   client:
//   const endpt = new GetUserExists( { email } );
//   const response = await appdata.server.fetch( endpt );   // { exists: true|false }
//
export class GetUserExists extends RestfulEndpoint<GetUserExists.Query, undefined, GetUserExists.Response>
{
    public readonly uri      : string = GetUserExists.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;   // authed admin/staff only (never anonymous)
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( query? : GetUserExists.Query )
    {
        super( query ?? {}, undefined );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [
            { field: "email", location: RestfulEndpoint.AttrLocation.QUERY_PARAM },
            { field: "phone", location: RestfulEndpoint.AttrLocation.QUERY_PARAM },
        ];
    }

    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetUserExists
{
    export const URI : string = apiPath( "auth", 1, "/users/exists" );   // /api/auth/v1/users/exists

    /** At least one of email / phone. Phone uniqueness counts only when verified (see Auth.UserProfile). */
    export interface Query
    {
        email? : string;
        phone? : string;    // E.164
    }

    export interface Response
    {
        exists      : boolean;
        emailTaken? : boolean;      // which identifier matched (admin context — safe here, never on the anon form)
        phoneTaken? : boolean;
    }

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetUserExists;
