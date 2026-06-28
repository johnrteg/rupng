//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// List the caller's active sessions / devices.
//
export class GetSessions extends RestfulEndpoint<{}, undefined, GetSessions.Response>
{
    public readonly uri      : string = GetSessions.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor() { super( {} ); }

    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetSessions
{
    export const URI : string = apiPath( "auth", 1, "/sessions" );   // /api/auth/v1/sessions

    export interface Session { sessionId : string; device? : string; ip? : string; createdAt? : string; lastSeenAt? : string; current : boolean; }
    export interface Response { sessions : Array<Session>; }

    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default GetSessions;
