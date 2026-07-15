//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";
import { Segment } from "./model/Segment";

//
// Edit a segment (name / query / exclusion flag). USER-gated, first-party. Server bumps the audit stamp;
// identity / accountId / status stay server-owned (archive is its own endpoint).
//
export class PatchSegment extends RestfulEndpoint< PatchSegment.Query, PatchSegment.Body, PatchSegment.Response >
{
    public readonly uri      : string = PatchSegment.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PATCH;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "updateSegment",
        summary:     "Update a segment",
        description: "Edits a segment's name / query / exclusion flag.",
        tags:        [ "Contact" ],
        errors:      { 404: "No such segment in this account" },
    };

    constructor( id? : string, body? : PatchSegment.Body ) { super( { id: id ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: true,
            properties: { name: { type: "string" }, query: { type: "object" }, isExclusion: { type: "boolean" } },
        };
    }
}

export namespace PatchSegment
{
    export const URI : string = apiPath( "contact", 1, "/segments/:id" );

    export interface Query { id : Type.UUID; }
    export interface Body extends RestfulEndpoint.AuthRequest
    {
        name?        : string;
        query?       : Segment.Query;
        isExclusion? : boolean;
        tags?        : Array<string>;
        sort?        : Segment.Sort;
        limit?       : number;
    }
    export interface Response extends Segment.Entity {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PatchSegment;
