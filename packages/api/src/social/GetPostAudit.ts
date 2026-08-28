//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, type Type } from "@repo/common";
import { SocialPost } from "./model/SocialPost";

//
// A post's append-only audit trail (submit/approve/reject/comment/resolve/schedule/publish). USER-gated.
//
export class GetPostAudit extends RestfulEndpoint< GetPostAudit.Query, undefined, GetPostAudit.Response >
{
    public readonly uri      : string = GetPostAudit.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getSocialPostAudit",
        summary:     "Get a post's audit trail",
        description: "Lists the append-only audit trail for a post's lifecycle transitions.",
        tags:        [ "Social" ],
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetPostAudit
{
    export const URI : string = apiPath( "social", 1, "/posts/:id/audit" );

    export interface Query { id : Type.UUID; }
    export interface Response { audit : Array<SocialPost.ReviewAudit>; }

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetPostAudit;
