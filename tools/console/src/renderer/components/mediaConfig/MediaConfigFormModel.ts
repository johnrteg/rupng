import { MediaConfig } from "@repo/api";

//
// MediaConfigFormModel — pure parse/merge helpers shared by MediaConfigForm's sections. Kept dependency-free
// (no @repo/common) since tools/console doesn't declare that package as a dep; a small explicit per-section
// merge is simpler than pulling in a new workspace dependency for one generic deep-merge helper.
//

export namespace MediaConfigFormModel
{
    /** Parse `content` as a MediaConfig.Config, filling any missing section from MediaConfig.DEFAULT so an
     *  older/partial config still renders. Returns null when the text isn't valid JSON — the caller falls
     *  back to a "fix in the JSON editor" message rather than guessing at broken content. */
    export function parse( content : string ) : MediaConfig.Config | null
    {
        if ( content.trim() === "" ) return MediaConfig.DEFAULT;
        let parsed : Partial<MediaConfig.Config>;
        try { parsed = JSON.parse( content ) as Partial<MediaConfig.Config>; }
        catch { return null; }
        return withDefaults( parsed );
    }

    /** Serialize a Config back to the SAME pretty-printed form the JSON editor uses (2-space indent), so
     *  toggling between editors never re-formats the document out from under the user. */
    export function stringify( config : MediaConfig.Config ) : string
    {
        return JSON.stringify( config, null, 2 );
    }

    /** Fill any missing top-level/nested section from MediaConfig.DEFAULT — tolerates an older/partial config
     *  the same way the service's own `ObjectUtils.withDefaults( row, DEFAULT )` read path does. */
    function withDefaults( parsed : Partial<MediaConfig.Config> ) : MediaConfig.Config
    {
        const fallback : MediaConfig.Config = MediaConfig.DEFAULT;
        return {
            upload: { ...fallback.upload, ...parsed.upload, maxSizeMbByKind: { ...fallback.upload.maxSizeMbByKind, ...parsed.upload?.maxSizeMbByKind } },
            variants: { ...fallback.variants, ...parsed.variants },
            delivery: { ...fallback.delivery, ...parsed.delivery },
            lifecycle: { ...fallback.lifecycle, ...parsed.lifecycle },
            scan: { ...fallback.scan, ...parsed.scan },
            limits: { ...fallback.limits, ...parsed.limits },
            autoTag: { ...fallback.autoTag, ...parsed.autoTag },
            downloads: { ...fallback.downloads, ...parsed.downloads },
            videoTargets: parsed.videoTargets ?? fallback.videoTargets,
            densities: parsed.densities ?? fallback.densities,
            render: { ...fallback.render, ...parsed.render },
            logLevel: parsed.logLevel ?? fallback.logLevel,
        };
    }
}

export default MediaConfigFormModel;
