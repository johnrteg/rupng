//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Print } from "./model/Print";

//
// Render a PROOF PDF for a template + sample merge data (print-1.4) — no mailpiece is created; this is the
// author-time "what will this look like" preview surfaced by the template designer (web).
//
export class PostPrintProof extends RestfulEndpoint< {}, PostPrintProof.Body, PostPrintProof.Response >
{
    public readonly uri      : string = PostPrintProof.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "renderPrintProof",
        summary:     "Render a proof PDF",
        description: "Renders a proof PDF preview for a template + sample merge data. Creates no mailpiece.",
        tags:        [ "Print" ],
    };

    constructor( body? : PostPrintProof.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "templateId" ],
            properties: { templateId: { type: "string" }, mergeData: { type: "object" } },
        };
    }
}

export namespace PostPrintProof
{
    export const URI : string = apiPath( "print", 1, "/proof" );
    // accountId is deliberately NOT part of the body — this is a user-facing (APP audience) route, the impl
    // resolves the account from the session (`auth.accountId`), never a client-supplied value.
    export interface Body extends RestfulEndpoint.AuthRequest { templateId : string; mergeData? : Record<string, unknown>; }
    export interface Response extends Print.ProofResult {}
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
    }
}

export default PostPrintProof;
// eof
