//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { EmailTemplate } from "./model/EmailTemplate";

//
// Restore an earlier template VERSION (email-2.7) — copies version N's snapshot into a NEW current version
// (bumping the version, recompiling), so history is never destroyed. The template returns to DRAFT for review.
//
export class PostEmailTemplateRevert extends RestfulEndpoint< PostEmailTemplateRevert.Query, PostEmailTemplateRevert.Body, PostEmailTemplateRevert.Response >
{
    public readonly uri      : string = PostEmailTemplateRevert.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "revertEmailTemplate",
        summary:     "Restore a template version",
        description: "Restores an earlier version as a new current version (history preserved).",
        tags:        [ "Email" ],
    };

    constructor( id? : string, body? : PostEmailTemplateRevert.Body ) { super( { id: id ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    { return { type: "object", required: [ "version" ], properties: { version: { type: "number" } } }; }
}

export namespace PostEmailTemplateRevert
{
    export const URI : string = apiPath( "email", 1, "/templates/:id/revert" );
    export interface Query { id : string; }
    export interface Body extends RestfulEndpoint.AuthRequest { version : number; }
    export interface Response { template : EmailTemplate.Entity; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND }
}

export default PostEmailTemplateRevert;
// eof
