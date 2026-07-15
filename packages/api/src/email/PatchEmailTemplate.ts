//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { EmailTemplate } from "./model/EmailTemplate";

//
// Update an email template (name / subject / doc). Bumps version; keeps status. Recompiles MJML/HTML server-side
// (email-2.1).
//
export class PatchEmailTemplate extends RestfulEndpoint< PatchEmailTemplate.Query, PatchEmailTemplate.Body, PatchEmailTemplate.Response >
{
    public readonly uri      : string = PatchEmailTemplate.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PATCH;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "updateEmailTemplate",
        summary:     "Update an email template",
        description: "Updates a template's name / subject / block doc (bumps version, recompiles MJML/HTML).",
        tags:        [ "Email" ],
    };

    constructor( id? : string, body? : PatchEmailTemplate.Body ) { super( { id: id ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", additionalProperties: true, properties: {
            name: { type: "string" }, subject: { type: "string" }, doc: { type: "object" }, notificationType: { type: "string" } } };
    }
}

export namespace PatchEmailTemplate
{
    export const URI : string = apiPath( "email", 1, "/templates/:id" );
    export interface Query { id : string; }
    export interface Body extends RestfulEndpoint.AuthRequest
    {
        name?             : string;
        subject?          : string;
        doc?              : EmailTemplate.Doc;
        notificationType? : EmailTemplate.NotificationType;
    }
    export interface Response extends EmailTemplate.Entity {}
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
    }
}

export default PatchEmailTemplate;
// eof
