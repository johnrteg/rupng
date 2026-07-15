//
import { Browse, Media } from "@repo/api";

import { BrowseProvider, BrowseContext, BrowseAcquisition } from "../BrowseProvider";

//
// svgl adapter — SVG LOGOS from the public svgl.app API (https://svgl.app/docs/api). KEYLESS: the API needs no
// token, so `ctx.apiKey` is ignored. Maps svgl's `{ id, title, category, route, url }` into the normalized
// `Browse.Result` (kind = IMAGE; SVGs import as ordinary image assets). NOTE: these are brand LOGOS — trademarks
// belong to their owners; use per each brand's guidelines (we record the source page as attribution).
//
export class SvglAdapter implements BrowseProvider
{
    public readonly provider : Browse.Provider = Browse.Provider.SVGL;

    private static readonly LICENSE : Media.License =
        { type: Media.LicenseType.CUSTOM, requiresAttribution: false, url: "https://svgl.app" };

    ////////////////////////////////////////////////////////////////////////////////////////////
    public info( enabledKinds : Array<Media.Kind> ) : Browse.ProviderInfo
    {
        return {
            provider: this.provider, label: "svgl (logos)",
            kinds: enabledKinds.filter( ( kind : Media.Kind ) : boolean => kind === Media.Kind.IMAGE ),
            canSearch: true, canGenerate: false, canDownloadFree: true, canPurchase: false, enabled: true,
        };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async search( query : Browse.Query, ctx : BrowseContext ) : Promise<Array<Browse.Result>>
    {
        if( !query.kinds.includes( Media.Kind.IMAGE ) ) return [];
        // svgl: `?search=<term>` filters; no term → the full catalog (we cap it to the per-provider limit)
        const term : string = query.text.trim();
        const url : string = term === "" ? "https://api.svgl.app" : `https://api.svgl.app?search=${ encodeURIComponent( term ) }`;
        const data : unknown = await SvglAdapter.fetchJson( url );
        const list : Array<Record<string, unknown>> = Array.isArray( data ) ? ( data as Array<Record<string, unknown>> ) : [];
        const results : Array<Browse.Result> = [];
        for( const item of list.slice( 0, ctx.limits.maxResultsPerProvider ) )
        {
            const result : Browse.Result | null = this.toResult( item );
            if( result !== null ) results.push( result );
        }
        return results;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // detail/pre-import — externalId encodes the svg URL + title (no by-id endpoint), so decode it directly
    public async get( externalId : string, _ctx : BrowseContext ) : Promise<Browse.Result | null>
    {
        const decoded : { url : string; title : string } | null = SvglAdapter.decodeId( externalId );
        if( decoded === null ) return null;
        return {
            provider: this.provider, externalId, kind: Media.Kind.IMAGE, title: decoded.title,
            thumbnailUrl: decoded.url, previewUrl: decoded.url, downloadUrl: decoded.url,
            attribution: "Logo via svgl.app", license: SvglAdapter.LICENSE, cost: { free: true },
            sourceUrl: "https://svgl.app", tags: [],
        };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async acquire( externalId : string, ctx : BrowseContext ) : Promise<BrowseAcquisition | null>
    {
        const result : Browse.Result | null = await this.get( externalId, ctx );
        if( result === null || result.downloadUrl === undefined ) return null;
        return { result, fetchUrl: result.downloadUrl };   // the import path fetches the SVG bytes + scans them
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // map one svgl entry → a normalized Result. `route` is the SVG URL (string) or a {light,dark} pair.
    private toResult( item : Record<string, unknown> ) : Browse.Result | null
    {
        const route : unknown = item.route;
        const svgUrl : string | undefined = typeof route === "string" ? route
            : ( typeof route === "object" && route !== null ) ? String( ( route as Record<string, unknown> ).light ?? "" ) : undefined;
        if( svgUrl === undefined || svgUrl === "" ) return null;
        const title : string = String( item.title ?? "Logo" );
        const category : string = String( item.category ?? "" );
        return {
            provider: this.provider, externalId: SvglAdapter.encodeId( svgUrl, title ), kind: Media.Kind.IMAGE, title,
            thumbnailUrl: svgUrl, previewUrl: svgUrl, downloadUrl: svgUrl,
            attribution: "Logo via svgl.app", license: SvglAdapter.LICENSE, cost: { free: true },
            sourceUrl: String( item.url ?? "https://svgl.app" ), tags: category === "" ? [] : [ category ],
        };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // externalId carries the svg URL + title (base64 JSON) so get/acquire need no extra API call
    private static encodeId( url : string, title : string ) : string
    {
        return Buffer.from( JSON.stringify( { url, title } ), "utf8" ).toString( "base64url" );
    }

    private static decodeId( externalId : string ) : { url : string; title : string } | null
    {
        try
        {
            const parsed : { url? : string; title? : string } = JSON.parse( Buffer.from( externalId, "base64url" ).toString( "utf8" ) );
            if( typeof parsed.url !== "string" ) return null;
            return { url: parsed.url, title: typeof parsed.title === "string" ? parsed.title : "Logo" };
        }
        catch { return null; }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // GET JSON from the public API; null on any failure (the factory reports per-provider status).
    private static async fetchJson( url : string ) : Promise<unknown>
    {
        try
        {
            const response : Response = await fetch( url );
            if( !response.ok ) return null;
            return await response.json();
        }
        catch { return null; }
    }
}
// eof
