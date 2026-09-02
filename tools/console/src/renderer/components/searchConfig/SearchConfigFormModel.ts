import { SearchConfig } from "@repo/api";

//
// SearchConfigFormModel — pure parse/merge helpers shared by SearchConfigForm's sections. Mirrors
// voiceConfig/VoiceConfigFormModel.ts (same rationale: no @repo/common dependency in tools/console, so a
// small explicit per-section merge stands in for `ObjectUtils.withDefaults`).
//

export namespace SearchConfigFormModel
{
    /** Parse `content` as a SearchConfig.Config, filling any missing section from SearchConfig.DEFAULT so an
     *  older/partial config still renders. Returns null when the text isn't valid JSON. */
    export function parse( content : string ) : SearchConfig.Config | null
    {
        if ( content.trim() === "" ) return SearchConfig.DEFAULT;
        let parsed : Partial<SearchConfig.Config>;
        try { parsed = JSON.parse( content ) as Partial<SearchConfig.Config>; }
        catch { return null; }
        return withDefaults( parsed );
    }

    /** Serialize a Config back to the SAME pretty-printed form the JSON editor uses (2-space indent). */
    export function stringify( config : SearchConfig.Config ) : string
    {
        return JSON.stringify( config, null, 2 );
    }

    /** Fill any missing top-level/nested section from SearchConfig.DEFAULT — tolerates an older/partial config. */
    function withDefaults( parsed : Partial<SearchConfig.Config> ) : SearchConfig.Config
    {
        const fallback : SearchConfig.Config = SearchConfig.DEFAULT;
        return {
            indexedTypes:    parsed.indexedTypes ?? fallback.indexedTypes,
            weights:         { ...fallback.weights, ...parsed.weights },
            cacheTtlSeconds: parsed.cacheTtlSeconds ?? fallback.cacheTtlSeconds,
            audit:           { ...fallback.audit, ...parsed.audit },
            logLevel:        parsed.logLevel ?? fallback.logLevel,
        };
    }
}

export default SearchConfigFormModel;
