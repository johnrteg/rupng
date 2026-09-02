//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Print } from "./model/Print";

//
// Batch address verification (print-2.1/2.7/2.8) — list hygiene (e.g. contact-import CASS pass). S2S ONLY;
// reuses the global cache + per-account AddressUsage billing the same as the single-address route.
//
export class PostPrintAddressVerifyBatch extends RestfulEndpoint< {}, PostPrintAddressVerifyBatch.Body, PostPrintAddressVerifyBatch.Response >
{
    public readonly uri      : string = PostPrintAddressVerifyBatch.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : undefined = undefined;   // S2S (INTERNAL audience) — no RBAC role
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.INTERNAL;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "verifyPrintAddressBatch",
        summary:     "Batch-verify postal addresses",
        description: "S2S only — CASS-standardizes (optionally NCOA) a batch of addresses for list hygiene, e.g. a contact import.",
        tags:        [ "Print" ],
    };

    constructor( body? : PostPrintAddressVerifyBatch.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: true, required: [ "accountId", "addresses" ],
            properties: { accountId: { type: "string" }, addresses: { type: "array" }, ncoa: { type: "boolean" } },
        };
    }
}

export namespace PostPrintAddressVerifyBatch
{
    export const URI : string = apiPath( "print", 1, "/address/verify/batch" );
    export interface Body extends RestfulEndpoint.NonAuthRequest { accountId : string; addresses : Array<Print.Address>; ncoa? : boolean; }
    export interface Response { results : Array<Print.AddressVerifyResult>; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST }
}

export default PostPrintAddressVerifyBatch;
// eof
