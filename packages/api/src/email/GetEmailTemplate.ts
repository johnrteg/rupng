//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { EmailTemplate } from "./model/EmailTemplate";

//
// Get a single email template by id (email-2.1).
//
export class GetEmailTemplate extends RestfulEndpoint< GetEmailTemplate.Query, undefined, GetEmailTemplate.Response >
{
    public readonly uri      : string = GetEmailTemplate.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getEmailTemplate",
        summary:     "Get an email template",
        description: "Fetches a single email template by id.",
        tags:        [ "Email" ],
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }

    // success body — one template under `{ template }`
    public getResponseSchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", required: [ "template" ],
            properties: {
                template: {
                    type: "object", description: "The template (Cognito-free, compiled html included).",
                    properties: {
                        id:               { type: "string" },
                        name:             { type: "string" },
                        scope:            { type: "string", enum: Object.values( EmailTemplate.Scope ) },
                        status:           { type: "string", enum: Object.values( EmailTemplate.Status ) },
                        notificationType: { type: "string" },
                        subject:          { type: "string" },
                        html:             { type: "string", description: "Compiled responsive HTML." },
                    },
                },
            },
        };
    }
}

export namespace GetEmailTemplate
{
    export const URI : string = apiPath( "email", 1, "/templates/:id" );
    export interface Query { id : string; }
    export interface Response { template : EmailTemplate.Entity; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND }
}

export default GetEmailTemplate;
// eof
