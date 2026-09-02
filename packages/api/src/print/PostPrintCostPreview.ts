//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Print } from "./model/Print";

//
// Per-piece × recipients cost + production/transit lead-time estimate (print-6.2/6.3) — runs before any run;
// the campaign's cross-channel cost cap consumes this to enforce its allocation at submit.
//
export class PostPrintCostPreview extends RestfulEndpoint< {}, PostPrintCostPreview.Body, PostPrintCostPreview.Response >
{
    public readonly uri      : string = PostPrintCostPreview.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "previewPrintCost",
        summary:     "Preview print run cost + lead time",
        description: "Estimates per-piece × recipients cost and the production+transit lead-time for a mailpiece type/mail-class/recipient count.",
        tags:        [ "Print" ],
    };

    constructor( body? : PostPrintCostPreview.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "type", "mailClass", "recipients" ],
            properties: {
                type:       { type: "string", enum: Object.values( Print.MailpieceType ) },
                mailClass:  { type: "string", enum: Object.values( Print.MailClass ) },
                recipients: { type: "number", minimum: 1 },
                provider:   { type: "string", enum: Object.values( Print.Provider ) },
            },
        };
    }
}

export namespace PostPrintCostPreview
{
    export const URI : string = apiPath( "print", 1, "/cost-preview" );
    // accountId is deliberately NOT part of the body — see PostPrintProof.Body's note.
    export interface Body extends RestfulEndpoint.AuthRequest, Omit<Print.CostPreviewRequest, "accountId"> {}
    export interface Response extends Print.CostPreviewResult {}
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED }
}

export default PostPrintCostPreview;
// eof
