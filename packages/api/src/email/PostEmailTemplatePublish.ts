//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { EmailTemplate } from "./model/EmailTemplate";

//
// PUBLISH a template — compile MJML→HTML, set status PUBLISHED, and make it the active one for its
// (scope, notificationType) case (demoting the previously-published one). The create → review → test → publish
// gate (email-2.1/2.7).
//
export class PostEmailTemplatePublish extends RestfulEndpoint< PostEmailTemplatePublish.Query, undefined, PostEmailTemplatePublish.Response >
{
    public readonly uri      : string = PostEmailTemplatePublish.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "publishEmailTemplate",
        summary:     "Publish an email template",
        description: "Publishes a template (compiles HTML, activates it for its notification case, demotes the prior one).",
        tags:        [ "Email" ],
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace PostEmailTemplatePublish
{
    export const URI : string = apiPath( "email", 1, "/templates/:id/publish" );
    export interface Query { id : string; }
    export interface Response extends EmailTemplate.Entity {}
    export enum Error
    {
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
    }
}

export default PostEmailTemplatePublish;
// eof
