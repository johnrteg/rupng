//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Sign out everywhere — revoke all of the caller's sessions (step-up recommended).
//
export class PostSessionsRevokeAll extends RestfulEndpoint<{}, undefined, PostSessionsRevokeAll.Response>
{
    public readonly uri      : string = PostSessionsRevokeAll.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor() { super( {} ); }

    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace PostSessionsRevokeAll
{
    export const URI : string = apiPath( "auth", 1, "/sessions/revoke-all" );   // /api/auth/v1/sessions/revoke-all

    export interface Response { ok : boolean; }

    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PostSessionsRevokeAll;
