//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { User } from "../auth/model/User";

//
// GetMemberships — the accounts the signed-in caller can act in (a user belongs to 1..N accounts). The
// account service owns the membership data (`members` ⊕ `accounts`), so this lists it here by the caller's
// id. Each entry carries the account name, the caller's max role in it, and whether they OWN it (their
// "own" account — the reset target if removed from their last-used one). Drives the nav's account switcher.
//
export class GetMemberships extends RestfulEndpoint< {}, undefined, GetMemberships.Response >
{
    public readonly uri      : string = GetMemberships.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.MINIMUM;   // any signed-in user lists their own
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor()
    {
        super( {} );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetMemberships
{
    export const URI : string = apiPath( "acct", 1, "/memberships" );   // /api/acct/v1/memberships

    export interface Response
    {
        accounts : Array<User.Membership>;
    }

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetMemberships;
