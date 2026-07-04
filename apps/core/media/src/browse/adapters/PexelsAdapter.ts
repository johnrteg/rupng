//
import { Browse, Media } from "@repo/api";

import { BrowseProvider, BrowseContext, BrowseAcquisition } from "../BrowseProvider";

//
// Pexels adapter — free photos + videos (https://www.pexels.com/api/). Auth: `Authorization: <api key>`.
// Pexels License: free to use, no attribution required (we still record the author). Maps the native photo /
// video shapes into the normalized `Browse.Result`.
//
export class PexelsAdapter implements BrowseProvider
{
    public readonly provider : Browse.Provider = Browse.Provider.PEXELS;

    private static readonly LICENSE : Media.License = { type: Media.LicenseType.ROYALTY_FREE, requiresAttribution: false, url: "https://www.pexels.com/license/" };

    ////////////////////////////////////////////////////////////////////////////////////////////
    public info( enabledKinds : Array<Media.Kind> ) : Browse.ProviderInfo
    {
        return {
            provider: this.provider, label: "Pexels",
            kinds: enabledKinds.filter( ( k ) => k === Media.Kind.IMAGE || k === Media.Kind.VIDEO ),
            canSearch: true, canGenerate: false, canDownloadFree: true, canPurchase: false, enabled: true,
        };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async search( query : Browse.Query, ctx : BrowseContext ) : Promise<Array<Browse.Result>>
    {
        const perPage : number = ctx.limits.maxResultsPerProvider;
        const page : number = query.page ?? 1;
        const results : Array<Browse.Result> = [];

        if( query.kinds.includes( Media.Kind.IMAGE ) )
        {
            const url : string = `https://api.pexels.com/v1/search?query=${ encodeURIComponent( query.text ) }&per_page=${ perPage }&page=${ page }`;
            const data = await this.fetchJson( url, ctx.apiKey );
            for( const photo of ( data?.photos ?? [] ) as Array<Record<string, unknown>> ) results.push( this.photoResult( photo ) );
        }
        if( query.kinds.includes( Media.Kind.VIDEO ) )
        {
            const url : string = `https://api.pexels.com/videos/search?query=${ encodeURIComponent( query.text ) }&per_page=${ perPage }&page=${ page }`;
            const data = await this.fetchJson( url, ctx.apiKey );
            for( const video of ( data?.videos ?? [] ) as Array<Record<string, unknown>> ) results.push( this.videoResult( video ) );
        }
        return results;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async get( externalId : string, ctx : BrowseContext ) : Promise<Browse.Result | null>
    {
        // externalId encodes "photo:<id>" | "video:<id>"
        const [ kind, id ] : Array<string> = externalId.split( ":" );
        const url : string = kind === "video" ? `https://api.pexels.com/videos/videos/${ id }` : `https://api.pexels.com/v1/photos/${ id }`;
        const data = await this.fetchJson( url, ctx.apiKey );
        if( !data ) return null;
        return kind === "video" ? this.videoResult( data ) : this.photoResult( data );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async acquire( externalId : string, ctx : BrowseContext ) : Promise<BrowseAcquisition | null>
    {
        const result : Browse.Result | null = await this.get( externalId, ctx );
        if( !result || !result.downloadUrl ) return null;
        return { result, fetchUrl: result.downloadUrl };   // the import path fetches the licensed bytes
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // GET the provider API with the key header; null on any failure (the factory reports per-provider status).
    private async fetchJson( url : string, apiKey : string ) : Promise<Record<string, any> | null>
    {
        try
        {
            const response : Response = await fetch( url, { headers: { Authorization: apiKey } } );
            if( !response.ok ) return null;
            return await response.json() as Record<string, any>;
        }
        catch { return null; }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private photoResult( photo : Record<string, any> ) : Browse.Result
    {
        const src : Record<string, string> = ( photo.src ?? {} ) as Record<string, string>;
        return {
            provider: this.provider, externalId: `photo:${ photo.id }`, kind: Media.Kind.IMAGE,
            title: ( photo.alt as string ) || `Pexels ${ photo.id }`,
            thumbnailUrl: src.tiny ?? src.small ?? src.medium ?? "",
            previewUrl: src.large ?? src.medium,
            downloadUrl: src.original ?? src.large2x ?? src.large,
            width: Number( photo.width ) || undefined, height: Number( photo.height ) || undefined,
            author: photo.photographer as string, attribution: `Photo by ${ photo.photographer } on Pexels`,
            license: PexelsAdapter.LICENSE, cost: { free: true },
            sourceUrl: ( photo.url as string ) ?? "", tags: [],
        };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private videoResult( video : Record<string, any> ) : Browse.Result
    {
        const files : Array<Record<string, any>> = ( video.video_files ?? [] ) as Array<Record<string, any>>;
        const best : Record<string, any> | undefined = files.slice().sort( ( a, b ) => ( Number( b.width ) || 0 ) - ( Number( a.width ) || 0 ) )[ 0 ];
        const pictures : Array<Record<string, string>> = ( video.video_pictures ?? [] ) as Array<Record<string, string>>;
        return {
            provider: this.provider, externalId: `video:${ video.id }`, kind: Media.Kind.VIDEO,
            title: `Pexels video ${ video.id }`,
            thumbnailUrl: ( video.image as string ) ?? pictures[ 0 ]?.picture ?? "",
            previewUrl: ( video.image as string ) ?? undefined,
            downloadUrl: best?.link as string,
            width: Number( video.width ) || undefined, height: Number( video.height ) || undefined,
            durationSec: Number( video.duration ) || undefined,
            author: video.user?.name as string, attribution: `Video by ${ video.user?.name } on Pexels`,
            license: PexelsAdapter.LICENSE, cost: { free: true },
            sourceUrl: ( video.url as string ) ?? "", tags: [],
        };
    }
}

export default PexelsAdapter;
