import { ReportConfig } from "@repo/api";

//
// ReportConfigFormModel — pure parse/merge helpers shared by ReportConfigForm's sections. Mirrors
// voiceConfig/VoiceConfigFormModel.ts (same rationale: no @repo/common dependency in tools/console, so a
// small explicit per-section merge stands in for `ObjectUtils.withDefaults`).
//

export namespace ReportConfigFormModel
{
    /** Parse `content` as a ReportConfig.Config, filling any missing field from ReportConfig.DEFAULT so an
     *  older/partial config still renders. Returns null when the text isn't valid JSON. */
    export function parse( content : string ) : ReportConfig.Config | null
    {
        if ( content.trim() === "" ) return ReportConfig.DEFAULT;
        let parsed : Partial<ReportConfig.Config>;
        try { parsed = JSON.parse( content ) as Partial<ReportConfig.Config>; }
        catch { return null; }
        return withDefaults( parsed );
    }

    /** Serialize a Config back to the SAME pretty-printed form the JSON editor uses (2-space indent). */
    export function stringify( config : ReportConfig.Config ) : string
    {
        return JSON.stringify( config, null, 2 );
    }

    /** Fill any missing field from ReportConfig.DEFAULT — tolerates an older/partial config. `retentionDays`
     *  is required by the schema, so DEFAULT.retentionDays is the fallback when a partial config omits it. */
    function withDefaults( parsed : Partial<ReportConfig.Config> ) : ReportConfig.Config
    {
        const fallback : ReportConfig.Config = ReportConfig.DEFAULT;
        return {
            retentionDays: parsed.retentionDays ?? fallback.retentionDays,
            logLevel:      parsed.logLevel ?? fallback.logLevel,
        };
    }
}

export default ReportConfigFormModel;
