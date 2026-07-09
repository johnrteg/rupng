//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Cancel a pending action (INTERNAL) — the Console revokes a queued action (marks it CANCELLED) so its landing
// link no longer works. A no-op on an already consumed/cancelled/expired one.
//
export class PostAuthActionCancel extends RestfulEndpoint< PostAuthActionCancel.Query, RestfulEndpoint.NonAuthRequest, PostAuthActionCancel.Response >
{
    public readonly uri      : string = PostAuthActionCancel.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role | undefined = Access.AppRole.APPLICATION;   // app/root staff
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( actionId? : string ) { super( { actionId: actionId ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "actionId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace PostAuthActionCancel
{
    export const URI : string = apiPath( "auth", 1, "/actions/:actionId/cancel" );
    export interface Query { actionId : string; }
    export interface Response { ok : boolean; }
}

export default PostAuthActionCancel;
// eof
