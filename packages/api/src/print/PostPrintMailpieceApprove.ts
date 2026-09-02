//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Approve a mailpiece's rendered proof (print-1.4) — required before a large run's submit proceeds. ACCOUNT —
// a spend-authorizing action (mail is billable + irreversible once submitted).
//
export class PostPrintMailpieceApprove extends RestfulEndpoint< PostPrintMailpieceApprove.Query, PostPrintMailpieceApprove.Body, PostPrintMailpieceApprove.Response >
{
    public readonly uri      : string = PostPrintMailpieceApprove.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "approvePrintMailpiece",
        summary:     "Approve a mailpiece's proof",
        description: "Marks a mailpiece's rendered proof approved — required before large-run submission proceeds.",
        tags:        [ "Print" ],
    };

    constructor( id? : string, body? : PostPrintMailpieceApprove.Body ) { super( { id: id ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return { type: "object", additionalProperties: false, properties: {} }; }
}

export namespace PostPrintMailpieceApprove
{
    export const URI : string = apiPath( "print", 1, "/mailpieces/:id/approve" );
    export interface Query { id : string; }
    export interface Body extends RestfulEndpoint.AuthRequest {}
    export interface Response { approved : true; }
    export enum Error
    {
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN    = NetworkUtils.Status.FORBIDDEN,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
    }
}

export default PostPrintMailpieceApprove;
// eof
