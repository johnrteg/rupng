import { PrintConfig } from "@repo/api";

//
// PrintConfigFormModel — pure parse/merge helpers shared by PrintConfigForm's sections. Mirrors
// voiceConfig/VoiceConfigFormModel.ts (no @repo/common dependency in tools/console, so a small explicit
// per-section merge stands in for `ObjectUtils.withDefaults`).
//

export namespace PrintConfigFormModel
{
    /** Parse `content` as a PrintConfig.Config, filling any missing section from PrintConfig.DEFAULT so an
     *  older/partial config still renders. Returns null when the text isn't valid JSON. */
    export function parse( content : string ) : PrintConfig.Config | null
    {
        if ( content.trim() === "" ) return PrintConfig.DEFAULT;
        let parsed : Partial<PrintConfig.Config>;
        try { parsed = JSON.parse( content ) as Partial<PrintConfig.Config>; }
        catch { return null; }
        return withDefaults( parsed );
    }

    /** Serialize a Config back to the SAME pretty-printed form the JSON editor uses (2-space indent). */
    export function stringify( config : PrintConfig.Config ) : string
    {
        return JSON.stringify( config, null, 2 );
    }

    /** Fill any missing top-level section from PrintConfig.DEFAULT — tolerates an older/partial config. */
    function withDefaults( parsed : Partial<PrintConfig.Config> ) : PrintConfig.Config
    {
        const fallback : PrintConfig.Config = PrintConfig.DEFAULT;
        return {
            defaultProvider:        parsed.defaultProvider ?? fallback.defaultProvider,
            providers:              parsed.providers ?? fallback.providers,
            defaultAddressVerifier: parsed.defaultAddressVerifier ?? fallback.defaultAddressVerifier,
            addressVerifiers:       parsed.addressVerifiers ?? fallback.addressVerifiers,
            defaultMailClass:       parsed.defaultMailClass ?? fallback.defaultMailClass,
            ncoaMaxAgeDays:         parsed.ncoaMaxAgeDays ?? fallback.ncoaMaxAgeDays,
            addressFreshDays:       parsed.addressFreshDays ?? fallback.addressFreshDays,
            limits:                 { ...fallback.limits, ...parsed.limits },
            logLevel:               parsed.logLevel ?? fallback.logLevel,
        };
    }
}

export default PrintConfigFormModel;
