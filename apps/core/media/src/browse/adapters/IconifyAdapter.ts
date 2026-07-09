//
import { Browse, Media } from "@repo/api";

import { BrowseProvider, BrowseContext, BrowseAcquisition } from "../BrowseProvider";

//
// Iconify adapter — SVG ICONS from the public Iconify API (https://iconify.design/docs/api). KEYLESS: no token
// needed, so `ctx.apiKey` is ignored. Search returns icon ids (`prefix:name`); the SVG for one is fetched from
// `/{prefix}/{name}.svg`. Icons import as ordinary image assets. NOTE: individual icon SETS carry their own
// licenses — we record the icon-set page as the source for attribution.
//
export class IconifyAdapter implements BrowseProvider
{
    public readonly provider : Browse.Provider = Browse.Provider.ICONIFY;

    private static readonly LICENSE : Media.License =
        { type: Media.LicenseType.CUSTOM, requiresAttribution: false, url: "https://iconify.design" };

    ////////////////////////////////////////////////////////////////////////////////////////////
    public info( enabledKinds : Array<Media.Kind> ) : Browse.ProviderInfo
    {
        return {
            provider: this.provider, label: "Iconify (icons)",
            kinds: enabledKinds.filter( ( kind : Media.Kind ) : boolean => kind === Media.Kind.IMAGE ),
            canSearch: true, canGenerate: false, canDownloadFree: true, canPurchase: false, enabled: true,
        };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async search( query : Browse.Query, ctx : BrowseContext ) : Promise<Array<Browse.Result>>
    {
        if( !query.kinds.includes( Media.Kind.IMAGE ) ) return [];
        // Iconify search REQUIRES a query term (there's no full-catalog listing)
        const term : string = query.text.trim();
        if( term === "" ) return [];
        const limit : number = Math.min( ctx.limits.maxResultsPerProvider, 999 );
        const url : string = `https://api.iconify.design/search?query=${ encodeURIComponent( term ) }&limit=${ limit }`;
        const data : { icons? : Array<string> } | null = await IconifyAdapter.fetchJson( url ) as { icons? : Array<string> } | null;
        const icons : Array<string> = data?.icons ?? [];
        const results : Array<Browse.Result> = [];
        for( const id of icons ) results.push( this.toResult( id ) );
        return results;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async get( externalId : string, _ctx : BrowseContext ) : Promise<Browse.Result | null>
    {
        if( !externalId.includes( ":" ) ) return null;
        return this.toResult( externalId );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async acquire( externalId : string, ctx : BrowseContext ) : Promise<BrowseAcquisition | null>
    {
        const result : Browse.Result | null = await this.get( externalId, ctx );
        if( result === null || result.downloadUrl === undefined ) return null;
        return { result, fetchUrl: result.downloadUrl };   // the import path fetches the SVG bytes + scans them
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // map an icon id ("prefix:name") → a normalized Result. The SVG is served at /{prefix}/{name}.svg.
    private toResult( id : string ) : Browse.Result
    {
        const [ prefix, name ] : Array<string> = id.split( ":" );
        const svgUrl : string = `https://api.iconify.design/${ prefix }/${ name }.svg`;
        return {
            provider: this.provider, externalId: id, kind: Media.Kind.IMAGE, title: name.replace( /-/g, " " ),
            thumbnailUrl: svgUrl, previewUrl: svgUrl, downloadUrl: svgUrl,
            attribution: `Icon from the "${ prefix }" set via Iconify`, license: IconifyAdapter.LICENSE, cost: { free: true },
            sourceUrl: `https://icon-sets.iconify.design/${ prefix }/${ name }/`, tags: [ prefix ],
        };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
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
