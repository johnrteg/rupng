//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Render a template to HTML with sample merge data (email-2.2) — the editor's live preview. Returns the compiled
// HTML + subject with merge tags substituted; no send.
//
export class PostEmailTemplatePreview extends RestfulEndpoint< PostEmailTemplatePreview.Query, PostEmailTemplatePreview.Body, PostEmailTemplatePreview.Response >
{
    public readonly uri      : string = PostEmailTemplatePreview.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "previewEmailTemplate",
        summary:     "Preview an email template",
        description: "Renders a template's MJML→HTML with sample merge data (no send).",
        tags:        [ "Email" ],
    };

    constructor( id? : string, body? : PostEmailTemplatePreview.Body ) { super( { id: id ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    { return { type: "object", additionalProperties: true, properties: { mergeData: { type: "object" } } }; }
}

export namespace PostEmailTemplatePreview
{
    export const URI : string = apiPath( "email", 1, "/templates/:id/preview" );
    export interface Query { id : string; }
    export interface Body extends RestfulEndpoint.AuthRequest { mergeData? : Record<string, unknown>; }
    export interface Response { subject : string; html : string; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND }
}

export default PostEmailTemplatePreview;
// eof
