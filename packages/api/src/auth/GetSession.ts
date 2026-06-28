//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { User } from "./model/User";

//
// The current session — returns the authenticated caller's `User.Entity` (Cognito ⊕ DynamoDB), or 401
// when there's no valid session. The client sends its access token as `Authorization: Bearer <token>`.
//
//   client:
//   const endpt = new GetSession( {} );
//   const response = await appdata.server.fetch( endpt );
//
export class GetSession extends RestfulEndpoint<{}, undefined, GetSession.Response>
{
    public readonly uri      : string = GetSession.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.MINIMUM;   // any authenticated caller
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

export namespace GetSession
{
    export const URI : string = apiPath( "auth", 1, "/session" );   // /api/auth/v1/session

    export interface Response extends User.Entity
    {
    }

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetSession;
