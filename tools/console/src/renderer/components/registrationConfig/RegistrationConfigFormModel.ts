import { RegistrationConfig } from "@repo/api";

//
// RegistrationConfigFormModel — pure parse/merge helpers shared by RegistrationConfigForm's sections. Mirrors
// voiceConfig/VoiceConfigFormModel.ts (same rationale: no @repo/common dependency in tools/console, so a
// small explicit per-section merge stands in for `ObjectUtils.withDefaults`).
//

export namespace RegistrationConfigFormModel
{
    /** Parse `content` as a RegistrationConfig.Config, filling any missing section from
     *  RegistrationConfig.DEFAULT so an older/partial config still renders. Returns null when the text isn't
     *  valid JSON. */
    export function parse( content : string ) : RegistrationConfig.Config | null
    {
        if ( content.trim() === "" ) return RegistrationConfig.DEFAULT;
        let parsed : Partial<RegistrationConfig.Config>;
        try { parsed = JSON.parse( content ) as Partial<RegistrationConfig.Config>; }
        catch { return null; }
        return withDefaults( parsed );
    }

    /** Serialize a Config back to the SAME pretty-printed form the JSON editor uses (2-space indent). */
    export function stringify( config : RegistrationConfig.Config ) : string
    {
        return JSON.stringify( config, null, 2 );
    }

    /** Fill any missing top-level/nested section from RegistrationConfig.DEFAULT — tolerates an older/partial
     *  config. */
    function withDefaults( parsed : Partial<RegistrationConfig.Config> ) : RegistrationConfig.Config
    {
        const fallback : RegistrationConfig.Config = RegistrationConfig.DEFAULT;
        return {
            cspId:              parsed.cspId ?? fallback.cspId,
            resellerId:         parsed.resellerId ?? fallback.resellerId,
            secretRef:          parsed.secretRef ?? fallback.secretRef,
            cvSecretRef:        parsed.cvSecretRef ?? fallback.cvSecretRef,
            providers:          parsed.providers ?? fallback.providers,
            useCaseMonthlyFee:  parsed.useCaseMonthlyFee ?? fallback.useCaseMonthlyFee,
            vettingFee:         parsed.vettingFee ?? fallback.vettingFee,
            defaultVettingFee:  parsed.defaultVettingFee ?? fallback.defaultVettingFee,
            maxLinesPerCampaign: parsed.maxLinesPerCampaign ?? fallback.maxLinesPerCampaign,
            reuseGraceDays:      parsed.reuseGraceDays ?? fallback.reuseGraceDays,
            defaultAreaCode:     parsed.defaultAreaCode ?? fallback.defaultAreaCode,
            pollSweep:           { ...fallback.pollSweep, ...parsed.pollSweep },
            logLevel:            parsed.logLevel ?? fallback.logLevel,
        };
    }
}

export default RegistrationConfigFormModel;
