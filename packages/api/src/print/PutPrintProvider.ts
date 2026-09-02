//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { PrintConfig } from "./model/PrintConfig";

//
// Configure one entry in EITHER the mail-fulfillment provider factory or the AddressVerifier factory
// (print-3.1/2.6) — `kind` selects which registry `id` resolves against. APPLICATION ⬆ (step-up — a
// credential-affecting admin action; enforced by auth's session step-up policy, not this contract).
//
export class PutPrintProvider extends RestfulEndpoint< PutPrintProvider.Query, PutPrintProvider.Body, PutPrintProvider.Response >
{
    public readonly uri      : string = PutPrintProvider.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PUT;
    public readonly access   : Access.Role = Access.AppRole.APPLICATION;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "setPrintProvider",
        summary:     "Configure a print provider",
        description: "Enables/disables a mail-fulfillment provider or address-verification source (and its secretRef/capabilities).",
        tags:        [ "Print" ],
    };

    constructor( kind? : "provider" | "verifier", id? : string, body? : PutPrintProvider.Body )
    { super( { kind: kind ?? "provider", id: id ?? "" }, body ); }

    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [
            { field: "kind", location: RestfulEndpoint.AttrLocation.URI, required: true },
            { field: "id",   location: RestfulEndpoint.AttrLocation.URI, required: true },
        ];
    }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "enabled" ],
            properties: {
                enabled:      { type: "boolean" },
                secretRef:    { type: "string" },
                capabilities: { type: "array" },   // only meaningful when kind = "verifier"
            },
        };
    }
}

export namespace PutPrintProvider
{
    export const URI : string = apiPath( "print", 1, "/providers/:kind/:id" );
    export interface Query { kind : "provider" | "verifier"; id : string; }
    export interface Body extends RestfulEndpoint.AuthRequest { enabled : boolean; secretRef? : string; capabilities? : Array<string>; }
    export interface Response { provider : PrintConfig.ProviderEntry | PrintConfig.VerifierEntry; }
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN    = NetworkUtils.Status.FORBIDDEN,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
    }
}

export default PutPrintProvider;
// eof
