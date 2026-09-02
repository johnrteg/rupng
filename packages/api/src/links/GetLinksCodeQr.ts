//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Render a code's URL as a QR glyph at print DPI (links-3.1) — print renders this into a mailpiece
// (print does NOT use a provider's built-in QR — one mint, one glyph source).
//
export class GetLinksCodeQr extends RestfulEndpoint< GetLinksCodeQr.Query, undefined, GetLinksCodeQr.Response >
{
    public readonly uri      : string = GetLinksCodeQr.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : undefined = undefined;   // S2S (INTERNAL audience) — no RBAC role
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.INTERNAL;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getLinkQr",
        summary:     "Render a link's QR glyph",
        description: "Renders the code's short URL as a QR glyph (base64-encoded PNG) at print DPI.",
        tags:        [ "Links" ],
    };

    constructor( code? : string ) { super( { code: code ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "code", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetLinksCodeQr
{
    export const URI : string = apiPath( "links", 1, "/:code/qr" );
    export interface Query { code : string; }
    export interface Response { png : string; }   // base64-encoded PNG bytes
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, NOT_FOUND = NetworkUtils.Status.NOT_FOUND }
}

export default GetLinksCodeQr;
// eof
