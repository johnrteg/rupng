//
import { Browse, Media } from "@repo/api";

import { BrowseProvider, BrowseContext, BrowseAcquisition } from "../BrowseProvider";

//
// Unsplash adapter — free photos (https://unsplash.com/documentation). Auth: `Authorization: Client-ID <key>`.
// Unsplash License: free to use; attribution appreciated (recorded). Images only. Note: production use must
// honor Unsplash's hotlinking + download-tracking guidelines (call the `download_location` endpoint on import).
//
export class UnsplashAdapter implements BrowseProvider
{
    public readonly provider : Browse.Provider = Browse.Provider.UNSPLASH;

    private static readonly LICENSE : Media.License = { type: Media.LicenseType.ROYALTY_FREE, requiresAttribution: false, url: "https://unsplash.com/license" };

    ////////////////////////////////////////////////////////////////////////////////////////////
    public info( enabledKinds : Array<Media.Kind> ) : Browse.ProviderInfo
    {
        return {
            provider: this.provider, label: "Unsplash",
            kinds: enabledKinds.filter( ( k ) => k === Media.Kind.IMAGE ),
            canSearch: true, canGenerate: false, canDownloadFree: true, canPurchase: false, enabled: true,
        };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async search( query : Browse.Query, ctx : BrowseContext ) : Promise<Array<Browse.Result>>
    {
        if( !query.kinds.includes( Media.Kind.IMAGE ) ) return [];
        const perPage : number = ctx.limits.maxResultsPerProvider;
        const page : number = query.page ?? 1;
        // Unsplash supports a color filter with its OWN vocabulary — map ours to it (unsupported ones are skipped)
        const colorParam : string = UnsplashAdapter.colorParam( query.filters?.color );
        const url : string = `https://api.unsplash.com/search/photos?query=${ encodeURIComponent( query.text ) }&per_page=${ perPage }&page=${ page }${ colorParam }`;
        const data = await this.fetchJson( url, ctx.apiKey );
        return ( ( data?.results ?? [] ) as Array<Record<string, any>> ).map( ( photo ) => this.photoResult( photo ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // map our named color → Unsplash's `color` param (`&color=…`), or "" when unset / unsupported by Unsplash.
    private static colorParam( color : string | undefined ) : string
    {
        if( color === undefined ) return "";
        const MAP : Record<string, string> =
            { red: "red", orange: "orange", yellow: "yellow", green: "green", blue: "blue", purple: "purple", pink: "magenta", black: "black", white: "white" };
        const mapped : string | undefined = MAP[ color ];
        return mapped ? `&color=${ mapped }` : "";
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async get( externalId : string, ctx : BrowseContext ) : Promise<Browse.Result | null>
    {
        const data = await this.fetchJson( `https://api.unsplash.com/photos/${ externalId }`, ctx.apiKey );
        return data ? this.photoResult( data ) : null;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async acquire( externalId : string, ctx : BrowseContext ) : Promise<BrowseAcquisition | null>
    {
        const result : Browse.Result | null = await this.get( externalId, ctx );
        if( !result || !result.downloadUrl ) return null;
        return { result, fetchUrl: result.downloadUrl };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private async fetchJson( url : string, apiKey : string ) : Promise<Record<string, any> | null>
    {
        try
        {
            const response : Response = await fetch( url, { headers: { Authorization: `Client-ID ${ apiKey }` } } );
            if( !response.ok ) return null;
            return await response.json() as Record<string, any>;
        }
        catch { return null; }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private photoResult( photo : Record<string, any> ) : Browse.Result
    {
        const urls : Record<string, string> = ( photo.urls ?? {} ) as Record<string, string>;
        const author : string = ( photo.user?.name as string ) ?? "Unknown";
        return {
            provider: this.provider, externalId: String( photo.id ), kind: Media.Kind.IMAGE,
            title: ( photo.description as string ) || ( photo.alt_description as string ) || `Unsplash ${ photo.id }`,
            thumbnailUrl: urls.thumb ?? urls.small ?? "",
            previewUrl: urls.regular ?? urls.small,
            downloadUrl: urls.full ?? urls.raw ?? urls.regular,
            width: Number( photo.width ) || undefined, height: Number( photo.height ) || undefined,
            author, attribution: `Photo by ${ author } on Unsplash`,
            license: UnsplashAdapter.LICENSE, cost: { free: true },
            sourceUrl: ( photo.links?.html as string ) ?? "", tags: ( ( photo.tags ?? [] ) as Array<Record<string, string>> ).map( ( t ) => t.title ).filter( Boolean ),
        };
    }
}

export default UnsplashAdapter;
