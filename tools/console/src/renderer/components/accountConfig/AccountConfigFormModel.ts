import { AccountConfig } from "@repo/api";

//
// AccountConfigFormModel — pure parse/merge helpers shared by AccountConfigForm's sections. Mirrors
// mediaConfig/MediaConfigFormModel.ts (same rationale: no @repo/common dependency in tools/console, so a
// small explicit per-section merge stands in for `ObjectUtils.withDefaults`).
//

export namespace AccountConfigFormModel
{
    /** Parse `content` as an AccountConfig.Config, filling any missing section from AccountConfig.DEFAULT so
     *  an older/partial config still renders. Returns null when the text isn't valid JSON. */
    export function parse( content : string ) : AccountConfig.Config | null
    {
        if ( content.trim() === "" ) return AccountConfig.DEFAULT;
        let parsed : Partial<AccountConfig.Config>;
        try { parsed = JSON.parse( content ) as Partial<AccountConfig.Config>; }
        catch { return null; }
        return withDefaults( parsed );
    }

    /** Serialize a Config back to the SAME pretty-printed form the JSON editor uses (2-space indent). */
    export function stringify( config : AccountConfig.Config ) : string
    {
        return JSON.stringify( config, null, 2 );
    }

    /** Fill any missing top-level/nested section from AccountConfig.DEFAULT — tolerates an older/partial config. */
    function withDefaults( parsed : Partial<AccountConfig.Config> ) : AccountConfig.Config
    {
        const fallback : AccountConfig.Config = AccountConfig.DEFAULT;
        return {
            hierarchy: { ...fallback.hierarchy, ...parsed.hierarchy },
            membership: { ...fallback.membership, ...parsed.membership },
            retention: { ...fallback.retention, ...parsed.retention },
            logLevel: parsed.logLevel ?? fallback.logLevel,
        };
    }
}

export default AccountConfigFormModel;
