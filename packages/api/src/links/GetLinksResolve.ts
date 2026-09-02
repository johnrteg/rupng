//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// The redirect (links-2.1) — MVP STAND-IN for the spec's `<short-domain>/<code>` public hot edge.
// Real short-domain custom-domain routing needs CloudFront + ACM + Route53 automation per
// ShortDomain (links-5.3/5.6) that doesn't exist on the platform yet; until then this resolves on
// the service's own versioned path. Swapping in real custom-domain routing later doesn't change this
// contract — a CloudFront behavior would just forward `<short-domain>/<code>` to this same endpoint.
//
export class GetLinksResolve extends RestfulEndpoint< GetLinksResolve.Query, undefined, GetLinksResolve.Response >
{
    public readonly uri      : string = GetLinksResolve.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : undefined = undefined;   // public — no RBAC, no auth
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "resolveLink",
        summary:     "Resolve a tracked link",
        description: "Validates the code, records the click/scan asynchronously, and redirects to the target.",
        tags:        [ "Links" ],
        errors:      { 404: "Unknown code", 410: "Expired code", 403: "Hibernated / blocked code" },
    };

    constructor( code? : string ) { super( { code: code ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [
            { field: "code",      location: RestfulEndpoint.AttrLocation.URI,    required: true },
            { field: "user-agent", location: RestfulEndpoint.AttrLocation.HEADER, required: false },
        ];
    }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetLinksResolve
{
    export const URI : string = apiPath( "links", 1, "/r/:code" );
    export interface Query { code : string; "user-agent"? : string; }
    export interface Response { target : string; }   // the impl issues a real 302; this is the documented shape
    export enum Error
    {
        NOT_FOUND = NetworkUtils.Status.NOT_FOUND,
        GONE      = NetworkUtils.Status.GONE,
        FORBIDDEN = NetworkUtils.Status.FORBIDDEN,
    }
}

export default GetLinksResolve;
// eof
