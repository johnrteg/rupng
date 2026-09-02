//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { PrintConfig } from "./model/PrintConfig";

//
// List configured mail-fulfillment providers + address-verification sources (print-3.1/2.6). APPLICATION —
// internal ops surface for the two independent provider-factory admin panels.
//
export class GetPrintProviders extends RestfulEndpoint< {}, undefined, GetPrintProviders.Response >
{
    public readonly uri      : string = GetPrintProviders.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AppRole.APPLICATION;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listPrintProviders",
        summary:     "List configured print providers",
        description: "Lists the mail-fulfillment provider factory's + the AddressVerifier factory's configured entries + enablement.",
        tags:        [ "Print" ],
    };

    constructor() { super( {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetPrintProviders
{
    export const URI : string = apiPath( "print", 1, "/providers" );
    export interface Response { providers : Record<string, PrintConfig.ProviderEntry>; addressVerifiers : Record<string, PrintConfig.VerifierEntry>; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN }
}

export default GetPrintProviders;
// eof
