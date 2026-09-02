//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Print } from "./model/Print";

//
// CASS (+ optional NCOA) address verification (print-2.1/2.2/2.7/2.8) — standardize + deliverability +
// deceased/vacant. Response indicates `cacheHit` (served from the global VerifiedAddress cache) + `charged`
// (charge-once-per-account — a second request for the same address by the same account is free).
//
export class PostPrintAddressVerify extends RestfulEndpoint< {}, PostPrintAddressVerify.Body, PostPrintAddressVerify.Response >
{
    public readonly uri      : string = PostPrintAddressVerify.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "verifyPrintAddress",
        summary:     "Verify a postal address",
        description: "CASS-standardizes (and optionally NCOA move-updates) an address. Served from the global VerifiedAddress cache when possible; charge-once-per-account.",
        tags:        [ "Print" ],
    };

    constructor( body? : PostPrintAddressVerify.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "address" ],
            properties: {
                address: { type: "object" },
                contactId: { type: "string" }, ncoa: { type: "boolean" },
                verifier:  { type: "string", enum: Object.values( Print.AddressVerifierId ) },
            },
        };
    }
}

export namespace PostPrintAddressVerify
{
    export const URI : string = apiPath( "print", 1, "/address/verify" );
    // accountId is deliberately NOT part of the body — see PostPrintProof.Body's note.
    export interface Body extends RestfulEndpoint.AuthRequest, Omit<Print.AddressVerifyRequest, "accountId"> {}
    export interface Response extends Print.AddressVerifyResult {}
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED }
}

export default PostPrintAddressVerify;
// eof
