import { EmailConfig } from "@repo/api";

//
// EmailConfigFormModel — pure parse/merge helpers shared by EmailConfigForm's sections. Mirrors
// mediaConfig/MediaConfigFormModel.ts (same rationale: no @repo/common dependency in tools/console, so a
// small explicit per-section merge stands in for `ObjectUtils.withDefaults`).
//

export namespace EmailConfigFormModel
{
    /** Parse `content` as an EmailConfig.Config, filling any missing section from EmailConfig.DEFAULT so an
     *  older/partial config still renders. Returns null when the text isn't valid JSON. */
    export function parse( content : string ) : EmailConfig.Config | null
    {
        if ( content.trim() === "" ) return EmailConfig.DEFAULT;
        let parsed : Partial<EmailConfig.Config>;
        try { parsed = JSON.parse( content ) as Partial<EmailConfig.Config>; }
        catch { return null; }
        return withDefaults( parsed );
    }

    /** Serialize a Config back to the SAME pretty-printed form the JSON editor uses (2-space indent). */
    export function stringify( config : EmailConfig.Config ) : string
    {
        return JSON.stringify( config, null, 2 );
    }

    /** Fill any missing top-level/nested section from EmailConfig.DEFAULT — tolerates an older/partial config. */
    function withDefaults( parsed : Partial<EmailConfig.Config> ) : EmailConfig.Config
    {
        const fallback : EmailConfig.Config = EmailConfig.DEFAULT;
        return {
            defaultProvider: parsed.defaultProvider ?? fallback.defaultProvider,
            systemProvider: parsed.systemProvider ?? fallback.systemProvider,
            systemSenders: parsed.systemSenders ?? fallback.systemSenders,
            defaultSystemSenderKey: parsed.defaultSystemSenderKey ?? fallback.defaultSystemSenderKey,
            systemSenderRouting: { ...fallback.systemSenderRouting, ...parsed.systemSenderRouting },
            limits: { ...fallback.limits, ...parsed.limits },
            scheduling: { ...fallback.scheduling, ...parsed.scheduling },
            providers: parsed.providers ?? fallback.providers,
            marketplaceEnabled: parsed.marketplaceEnabled ?? fallback.marketplaceEnabled,
            webFonts: parsed.webFonts ?? fallback.webFonts,
            logLevel: parsed.logLevel ?? fallback.logLevel,
        };
    }
}

export default EmailConfigFormModel;
