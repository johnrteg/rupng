import { TextingConfig } from "@repo/api";

//
// TextingConfigFormModel — pure parse/merge helpers shared by TextingConfigForm's sections. Mirrors
// emailConfig/EmailConfigFormModel.ts (same rationale: no @repo/common dependency in tools/console, so a
// small explicit per-section merge stands in for `ObjectUtils.withDefaults`).
//

export namespace TextingConfigFormModel
{
    /** Parse `content` as a TextingConfig.Config, filling any missing section from TextingConfig.DEFAULT so
     *  an older/partial config still renders. Returns null when the text isn't valid JSON. */
    export function parse( content : string ) : TextingConfig.Config | null
    {
        if ( content.trim() === "" ) return TextingConfig.DEFAULT;
        let parsed : Partial<TextingConfig.Config>;
        try { parsed = JSON.parse( content ) as Partial<TextingConfig.Config>; }
        catch { return null; }
        return withDefaults( parsed );
    }

    /** Serialize a Config back to the SAME pretty-printed form the JSON editor uses (2-space indent). */
    export function stringify( config : TextingConfig.Config ) : string
    {
        return JSON.stringify( config, null, 2 );
    }

    /** Fill any missing top-level field from TextingConfig.DEFAULT — tolerates an older/partial config. */
    function withDefaults( parsed : Partial<TextingConfig.Config> ) : TextingConfig.Config
    {
        const fallback : TextingConfig.Config = TextingConfig.DEFAULT;
        return {
            defaultProvider: parsed.defaultProvider ?? fallback.defaultProvider,
            providers: parsed.providers ?? fallback.providers,
            logLevel: parsed.logLevel ?? fallback.logLevel,
        };
    }
}

export default TextingConfigFormModel;
