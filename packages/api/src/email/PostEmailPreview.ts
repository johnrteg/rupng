//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { EmailTemplate } from "./model/EmailTemplate";

//
// Preview an UNSAVED template doc (email-2.6) — the editor's live preview in "document" mode. Compiles the
// block doc → MJML/HTML and substitutes sample merge data, WITHOUT a stored template (unlike
// PostEmailTemplatePreview which is by id). No send.
//
export class PostEmailPreview extends RestfulEndpoint< {}, PostEmailPreview.Body, PostEmailPreview.Response >
{
    public readonly uri      : string = PostEmailPreview.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "previewEmailDoc",
        summary:     "Preview an email doc",
        description: "Compiles an unsaved block doc to HTML with sample merge data (no stored template, no send).",
        tags:        [ "Email" ],
    };

    constructor( body? : PostEmailPreview.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    { return { type: "object", additionalProperties: true, required: [ "doc" ], properties: { doc: { type: "object" }, subject: { type: "string" }, mergeData: { type: "object" } } }; }
}

export namespace PostEmailPreview
{
    export const URI : string = apiPath( "email", 1, "/preview" );
    export interface Body extends RestfulEndpoint.AuthRequest { doc : EmailTemplate.Doc; subject? : string; mergeData? : Record<string, unknown>; }
    export interface Response { subject : string; html : string; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED }
}

export default PostEmailPreview;
// eof
