//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { EmailTemplate } from "./model/EmailTemplate";

//
// Create an email template (email-2.1). Server assigns id / version / status (DRAFT) / audit. Body is an
// EmailTemplate.Create (the JSON block doc + name + scope + optional notificationType). Validated loosely — the
// block tree is service-owned.
//
export class PostEmailTemplate extends RestfulEndpoint< {}, PostEmailTemplate.Body, PostEmailTemplate.Response >
{
    public readonly uri      : string = PostEmailTemplate.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "createEmailTemplate",
        summary:     "Create an email template",
        description: "Creates a draft email template (JSON block tree → MJML → HTML).",
        tags:        [ "Email" ],
    };

    constructor( body? : PostEmailTemplate.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: true, required: [ "name", "scope", "subject", "doc" ],
            properties: {
                name:             { type: "string", minLength: 1 },
                scope:            { type: "string", enum: Object.values( EmailTemplate.Scope ) },
                notificationType: { type: "string" },
                subject:          { type: "string" },
                doc:              { type: "object" },
            },
        };
    }
}

export namespace PostEmailTemplate
{
    export const URI : string = apiPath( "email", 1, "/templates" );
    export interface Body extends RestfulEndpoint.AuthRequest, EmailTemplate.Create {}
    export interface Response extends EmailTemplate.Entity {}
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
    }
}

export default PostEmailTemplate;
// eof
