import { SurveyConfig } from "@repo/api";

//
// SurveyConfigFormModel — pure parse/merge helpers shared by SurveyConfigForm. Mirrors
// emailConfig/EmailConfigFormModel.ts (no @repo/common dependency in tools/console).
//

export namespace SurveyConfigFormModel
{
    /** Parse `content` as a SurveyConfig.Config, filling any missing field from SurveyConfig.DEFAULT so an
     *  older/partial config still renders. Returns null when the text isn't valid JSON. */
    export function parse( content : string ) : SurveyConfig.Config | null
    {
        if ( content.trim() === "" ) return SurveyConfig.DEFAULT;
        let parsed : Partial<SurveyConfig.Config>;
        try { parsed = JSON.parse( content ) as Partial<SurveyConfig.Config>; }
        catch { return null; }
        return withDefaults( parsed );
    }

    /** Serialize a Config back to the SAME pretty-printed form the JSON editor uses (2-space indent). */
    export function stringify( config : SurveyConfig.Config ) : string
    {
        return JSON.stringify( config, null, 2 );
    }

    /** Fill any missing field from SurveyConfig.DEFAULT — tolerates an older/partial config. */
    function withDefaults( parsed : Partial<SurveyConfig.Config> ) : SurveyConfig.Config
    {
        const fallback : SurveyConfig.Config = SurveyConfig.DEFAULT;
        return {
            anonymousDefault:          parsed.anonymousDefault ?? fallback.anonymousDefault,
            abandonmentTimeoutMinutes: parsed.abandonmentTimeoutMinutes ?? fallback.abandonmentTimeoutMinutes,
            partialRetentionDays:      parsed.partialRetentionDays ?? fallback.partialRetentionDays,
            logLevel:                  parsed.logLevel ?? fallback.logLevel,
        };
    }
}

export default SurveyConfigFormModel;
