//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// S2S forget hook (report-11.1) — the `contact` forget fan-out calls this to purge artifacts containing a
// forgotten subject's PII ahead of the retention-TTL expiry. Idempotent — purging an already-purged/unknown
// subject is a no-op, not an error. INTERNAL audience — no RBAC role.
//
export class PostReportInternalErase extends RestfulEndpoint< {}, PostReportInternalErase.Body, PostReportInternalErase.Response >
{
    public readonly uri      : string = PostReportInternalErase.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : undefined = undefined;   // S2S (INTERNAL audience) — no RBAC role
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.INTERNAL;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "eraseReportSubject",
        summary:     "Erase a subject's PII from report artifacts",
        description: "S2S forget hook — purges artifacts containing a forgotten subject's PII ahead of the retention-TTL expiry.",
        tags:        [ "Report" ],
    };

    constructor( body? : PostReportInternalErase.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    { return { type: "object", additionalProperties: false, required: [ "accountId", "subjectId" ], properties: { accountId: { type: "string" }, subjectId: { type: "string" } } }; }
}

export namespace PostReportInternalErase
{
    export const URI : string = apiPath( "report", 1, "/internal/erase" );
    export interface Body extends RestfulEndpoint.NonAuthRequest { accountId : string; subjectId : string; }
    export interface Response { purged : number; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST }
}

export default PostReportInternalErase;
// eof
