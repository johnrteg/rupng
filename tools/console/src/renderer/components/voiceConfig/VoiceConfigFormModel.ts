import { VoiceConfig } from "@repo/api";

//
// VoiceConfigFormModel — pure parse/merge helpers shared by VoiceConfigForm's sections. Mirrors
// emailConfig/EmailConfigFormModel.ts (same rationale: no @repo/common dependency in tools/console, so a
// small explicit per-section merge stands in for `ObjectUtils.withDefaults`).
//

export namespace VoiceConfigFormModel
{
    /** Parse `content` as a VoiceConfig.Config, filling any missing section from VoiceConfig.DEFAULT so an
     *  older/partial config still renders. Returns null when the text isn't valid JSON. */
    export function parse( content : string ) : VoiceConfig.Config | null
    {
        if ( content.trim() === "" ) return VoiceConfig.DEFAULT;
        let parsed : Partial<VoiceConfig.Config>;
        try { parsed = JSON.parse( content ) as Partial<VoiceConfig.Config>; }
        catch { return null; }
        return withDefaults( parsed );
    }

    /** Serialize a Config back to the SAME pretty-printed form the JSON editor uses (2-space indent). */
    export function stringify( config : VoiceConfig.Config ) : string
    {
        return JSON.stringify( config, null, 2 );
    }

    /** Fill any missing top-level/nested section from VoiceConfig.DEFAULT — tolerates an older/partial config. */
    function withDefaults( parsed : Partial<VoiceConfig.Config> ) : VoiceConfig.Config
    {
        const fallback : VoiceConfig.Config = VoiceConfig.DEFAULT;
        return {
            defaultProvider:  parsed.defaultProvider ?? fallback.defaultProvider,
            limits:           { ...fallback.limits, ...parsed.limits },
            quietHours:       { ...fallback.quietHours, ...parsed.quietHours },
            providers:        parsed.providers ?? fallback.providers,
            recordingEnabled:     parsed.recordingEnabled ?? fallback.recordingEnabled,
            transcriptionEnabled: parsed.transcriptionEnabled ?? fallback.transcriptionEnabled,
            amdEnabled:           parsed.amdEnabled ?? fallback.amdEnabled,
            logLevel:             parsed.logLevel ?? fallback.logLevel,
        };
    }
}

export default VoiceConfigFormModel;
