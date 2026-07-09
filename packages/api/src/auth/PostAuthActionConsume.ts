//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { AuthAction } from "./model/AuthAction";

//
// Consume a pending action (the no-auth LANDING page calls this) — marks it CONSUMED (recording when) and
// performs the type's effect. Anonymous (the token is the credential); fails if missing / expired / already used.
//
export class PostAuthActionConsume extends RestfulEndpoint< PostAuthActionConsume.Query, PostAuthActionConsume.Body, PostAuthActionConsume.Response >
{
    public readonly uri      : string = PostAuthActionConsume.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role | undefined = undefined;   // non-authenticated (token-gated)
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( token? : string, body? : PostAuthActionConsume.Body ) { super( { token: token ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "token", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return { type: "object", additionalProperties: true, properties: { params: { type: "object" } } }; }
}

export namespace PostAuthActionConsume
{
    export const URI : string = apiPath( "auth", 1, "/actions/:token/consume" );
    export interface Query { token : string; }
    export interface Body extends RestfulEndpoint.NonAuthRequest { params? : Record<string, string>; }   // e.g. a new password for reset
    export interface Response { action : AuthAction.PublicView; }
    export enum Error { NOT_FOUND = NetworkUtils.Status.NOT_FOUND, GONE = NetworkUtils.Status.GONE }
}

export default PostAuthActionConsume;
// eof
