//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Audit } from "./model/Audit";

//
// Filtered export of the acting account's audit trail — DSAR / SOC 2 evidence (audit-5.3). ACCOUNT
// admin only. The export action itself lands in the trail (the impl calls the same `Application.audit()`
// path every other action does — no special-cased "audit of audit" endpoint).
//
export class PostAuditExport extends RestfulEndpoint< {}, PostAuditExport.Body, PostAuditExport.Response >
{
    public readonly uri      : string = PostAuditExport.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "postAuditExport",
        summary:     "Export the account's audit trail",
        description: "Filtered export of the acting account's audit trail for a DSAR / SOC 2 evidence request.",
        tags:        [ "Audit" ],
    };

    constructor( body? : PostAuditExport.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", additionalProperties: false, required: [ "filter", "format" ], properties: {
            filter: { type: "object" },
            format: { type: "string", enum: [ "json", "csv" ] },
        } };
    }
}

export namespace PostAuditExport
{
    export const URI : string = apiPath( "audit", 1, "/export" );

    export interface Body extends RestfulEndpoint.AuthRequest, Audit.ExportRequest {}

    export interface Response extends Audit.ExportResult {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN             = NetworkUtils.Status.FORBIDDEN,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostAuditExport;
// eof
