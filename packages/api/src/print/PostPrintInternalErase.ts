//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// S2S forget hook (print-7.1) — the `contact` forget fan-out calls this to purge address + merge data in every
// mailpiece addressed to `contactId`. The global, contact-free `VerifiedAddress` cache is NEVER touched (it
// carries no person linkage — see SPECS.md gap #8); only THIS account's mailpiece rows are redacted. Idempotent
// — re-erasing an already-erased/unknown contact matches zero rows, not an error.
//
export class PostPrintInternalErase extends RestfulEndpoint< {}, PostPrintInternalErase.Body, PostPrintInternalErase.Response >
{
    public readonly uri      : string = PostPrintInternalErase.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : undefined = undefined;   // S2S (INTERNAL audience) — no RBAC role
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.INTERNAL;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "erasePrintContact",
        summary:     "Erase a contact's mailpiece PII",
        description: "S2S forget hook — purges address + merge data in every mailpiece addressed to this contact. The global VerifiedAddress cache is never touched.",
        tags:        [ "Print" ],
    };

    constructor( body? : PostPrintInternalErase.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    { return { type: "object", additionalProperties: false, required: [ "accountId", "contactId" ], properties: { accountId: { type: "string" }, contactId: { type: "string" } } }; }
}

export namespace PostPrintInternalErase
{
    export const URI : string = apiPath( "print", 1, "/internal/erase" );
    export interface Body extends RestfulEndpoint.NonAuthRequest { accountId : string; contactId : string; }
    export interface Response { erased : number; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST }
}

export default PostPrintInternalErase;
// eof
