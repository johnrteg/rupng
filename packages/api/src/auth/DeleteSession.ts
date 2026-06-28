//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Logout — revoke the caller's sessions (global sign-out). The client sends its access token as
// `Authorization: Bearer <token>`.
//
//   client:
//   const endpt = new DeleteSession();
//   await appdata.server.fetch( endpt );
//
export class DeleteSession extends RestfulEndpoint<{}, undefined, DeleteSession.Response>
{
    public readonly uri      : string = DeleteSession.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.DELETE;
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

export namespace DeleteSession
{
    export const URI : string = apiPath( "auth", 1, "/session" );   // /api/auth/v1/session

    export interface Response
    {
        ok : boolean;
    }

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default DeleteSession;
