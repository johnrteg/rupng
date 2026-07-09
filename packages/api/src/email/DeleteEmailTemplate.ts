//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Archive an email template (soft — status → ARCHIVED; history retained). A PUBLISHED template can't be
// archived while it's the active one for its notification case (email-2.1/2.7).
//
export class DeleteEmailTemplate extends RestfulEndpoint< DeleteEmailTemplate.Query, undefined, DeleteEmailTemplate.Response >
{
    public readonly uri      : string = DeleteEmailTemplate.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.DELETE;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "archiveEmailTemplate",
        summary:     "Archive an email template",
        description: "Archives a template (soft-delete; can't archive the active published template for a case).",
        tags:        [ "Email" ],
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace DeleteEmailTemplate
{
    export const URI : string = apiPath( "email", 1, "/templates/:id" );
    export interface Query { id : string; }
    export interface Response { archived : boolean; }
    export enum Error
    {
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
        CONFLICT     = NetworkUtils.Status.CONFLICT,   // active published template for a case
    }
}

export default DeleteEmailTemplate;
// eof
