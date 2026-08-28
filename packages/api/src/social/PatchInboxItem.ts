//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, type Type } from "@repo/common";
import { SocialInbound } from "./model/SocialInbound";

//
// Update an inbox item — set/clear tags, flip open/handled. USER-gated.
//
export class PatchInboxItem extends RestfulEndpoint< PatchInboxItem.Query, PatchInboxItem.Body, PatchInboxItem.Response >
{
    public readonly uri      : string = PatchInboxItem.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PATCH;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "updateSocialInboxItem",
        summary:     "Update an inbox item",
        description: "Sets/clears tags or flips open/handled on an inbound item.",
        tags:        [ "Social" ],
        errors:      { 404: "No such inbox item in this account" },
    };

    constructor( id? : string, body? : PatchInboxItem.Body ) { super( { id: id ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    { return { type: "object", additionalProperties: true, properties: { tags: { type: "array" }, status: { type: "string" } } }; }
}

export namespace PatchInboxItem
{
    export const URI : string = apiPath( "social", 1, "/inbox/:id" );

    export interface Query { id : Type.UUID; }
    export interface Body extends RestfulEndpoint.AuthRequest
    {
        tags?   : Array<SocialInbound.Tag>;
        status? : SocialInbound.Status;
    }
    export interface Response extends SocialInbound.Entity {}

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PatchInboxItem;
