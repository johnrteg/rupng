//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { User } from "./model/User";

//
// Admin/staff user search. Filter by any combination of accountId / email / phone / first / last name
// (all optional — no filters = all, paged). Returns the composed `User.Entity` rows (Cognito ⊕ DynamoDB).
// Account membership lookups (who's in account X) are the account service's `/account/{id}/members`;
// this is the auth-owned global identity search.
//
//   client:
//   const endpt = new GetUsers( { email } );
//   const response = await appdata.server.fetch( endpt );
//
export class GetUsers extends RestfulEndpoint<GetUsers.Query, undefined, GetUsers.Response>
{
    public readonly uri      : string = GetUsers.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;   // account admin (senior app roles satisfy it)
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( query? : GetUsers.Query )
    {
        super( query ?? {}, undefined );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [
            { field: "accountId", location: RestfulEndpoint.AttrLocation.QUERY_PARAM },
            { field: "email",     location: RestfulEndpoint.AttrLocation.QUERY_PARAM },
            { field: "phone",     location: RestfulEndpoint.AttrLocation.QUERY_PARAM },
            { field: "firstName", location: RestfulEndpoint.AttrLocation.QUERY_PARAM },
            { field: "lastName",  location: RestfulEndpoint.AttrLocation.QUERY_PARAM },
        ];
    }

    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetUsers
{
    export const URI : string = apiPath( "auth", 1, "/users" );   // /api/auth/v1/users

    /** All filters optional; combine with AND. Omit all to list everyone (paged). */
    export interface Query
    {
        accountId? : string;    // users who are members of this account
        email?     : string;    // exact / prefix match (impl-defined)
        phone?     : string;    // E.164
        firstName? : string;
        lastName?  : string;
    }

    export interface Response
    {
        users : Array<User.Entity>;
        total : number;
    }

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetUsers;
