//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { EmailTemplate } from "./model/EmailTemplate";

//
// List email templates for the account (+ SYSTEM templates), optionally filtered by scope / notificationType /
// status (email-2.1).
//
export class GetEmailTemplates extends RestfulEndpoint< GetEmailTemplates.Query, undefined, GetEmailTemplates.Response >
{
    public readonly uri      : string = GetEmailTemplates.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listEmailTemplates",
        summary:     "List email templates",
        description: "Lists the account's email templates (and system templates), optionally filtered by scope / notification type / status.",
        tags:        [ "Email" ],
    };

    constructor( query? : GetEmailTemplates.Query ) { super( query ?? {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [
            { field: "scope",            location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "notificationType", location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "status",           location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
        ];
    }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }

    // success body — the account's (+ system) templates under `{ records }`
    public getResponseSchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", required: [ "records" ],
            properties: {
                records: {
                    type: "array", description: "Email templates (account + system).",
                    items: {
                        type: "object",
                        properties: {
                            id:               { type: "string", description: "Template id." },
                            name:             { type: "string", description: "Display name." },
                            scope:            { type: "string", enum: Object.values( EmailTemplate.Scope ),  description: "SYSTEM (platform) or ACCOUNT." },
                            status:           { type: "string", enum: Object.values( EmailTemplate.Status ), description: "DRAFT / PUBLISHED / ARCHIVED." },
                            notificationType: { type: "string", description: "The notification case this serves (if any)." },
                            subject:          { type: "string", description: "Subject line (may carry merge tags)." },
                            version:          { type: "number", description: "Version (bumps on each save)." },
                        },
                    },
                },
            },
        };
    }
}

export namespace GetEmailTemplates
{
    export const URI : string = apiPath( "email", 1, "/templates" );
    export interface Query { scope? : string; notificationType? : string; status? : string; }
    export interface Response { records : Array<EmailTemplate.Entity>; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED }
}

export default GetEmailTemplates;
// eof
