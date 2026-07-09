//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { EmailTemplate } from "./model/EmailTemplate";

//
// Fetch an earlier VERSION of a template (email-2.7) — reads the immutable S3 body snapshot for `version` and
// returns its editable doc + subject + compiled HTML. Powers the version-history dialog's preview + restore.
//
export class GetEmailTemplateVersion extends RestfulEndpoint< GetEmailTemplateVersion.Query, undefined, GetEmailTemplateVersion.Response >
{
    public readonly uri      : string = GetEmailTemplateVersion.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getEmailTemplateVersion",
        summary:     "Get a template version",
        description: "Reads an earlier version's snapshot (doc + subject + compiled HTML) from history.",
        tags:        [ "Email" ],
    };

    constructor( id? : string, version? : number ) { super( { id: id ?? "", version: version !== undefined ? String( version ) : "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [
            { field: "id",      location: RestfulEndpoint.AttrLocation.URI, required: true },
            { field: "version", location: RestfulEndpoint.AttrLocation.URI, required: true },
        ];
    }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetEmailTemplateVersion
{
    export const URI : string = apiPath( "email", 1, "/templates/:id/versions/:version" );
    export interface Query { id : string; version : string; }
    export interface Response { body : EmailTemplate.VersionBody; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND }
}

export default GetEmailTemplateVersion;
// eof
