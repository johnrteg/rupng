import { SocialConfig } from "@repo/api";

//
// SocialConfigFormModel — pure parse/merge helpers shared by SocialConfigForm's sections. Mirrors
// emailConfig/EmailConfigFormModel.ts (no @repo/common dependency in tools/console, so a small
// explicit per-section merge stands in for `ObjectUtils.withDefaults`).
//

export namespace SocialConfigFormModel
{
    /** Parse `content` as a SocialConfig.Config, filling any missing section from SocialConfig.DEFAULT
     *  so an older/partial config still renders. Returns null when the text isn't valid JSON. */
    export function parse( content : string ) : SocialConfig.Config | null
    {
        if ( content.trim() === "" ) return SocialConfig.DEFAULT;
        let parsed : Partial<SocialConfig.Config>;
        try { parsed = JSON.parse( content ) as Partial<SocialConfig.Config>; }
        catch { return null; }
        return withDefaults( parsed );
    }

    /** Serialize a Config back to the SAME pretty-printed form the JSON editor uses (2-space indent). */
    export function stringify( config : SocialConfig.Config ) : string
    {
        return JSON.stringify( config, null, 2 );
    }

    /** Fill any missing top-level/nested section from SocialConfig.DEFAULT — tolerates an older/partial config. */
    function withDefaults( parsed : Partial<SocialConfig.Config> ) : SocialConfig.Config
    {
        const fallback : SocialConfig.Config = SocialConfig.DEFAULT;
        return {
            poll:        { ...fallback.poll, ...parsed.poll },
            refresh:     { ...fallback.refresh, ...parsed.refresh },
            approvals:   { ...fallback.approvals, ...parsed.approvals },
            maxProfiles: { ...fallback.maxProfiles, ...parsed.maxProfiles },
            logLevel:    parsed.logLevel ?? fallback.logLevel,
        };
    }
}

export default SocialConfigFormModel;
