import { AuthConfig } from "@repo/api";

//
// AuthConfigFormModel — pure parse/merge helpers shared by AuthConfigForm's sections. Mirrors
// mediaConfig/MediaConfigFormModel.ts (same rationale: no @repo/common dependency in tools/console, so a
// small explicit per-section merge stands in for `ObjectUtils.withDefaults`).
//

export namespace AuthConfigFormModel
{
    /** Parse `content` as an AuthConfig.Config, filling any missing section from AuthConfig.DEFAULT so an
     *  older/partial config still renders. Returns null when the text isn't valid JSON. */
    export function parse( content : string ) : AuthConfig.Config | null
    {
        if ( content.trim() === "" ) return AuthConfig.DEFAULT;
        let parsed : Partial<AuthConfig.Config>;
        try { parsed = JSON.parse( content ) as Partial<AuthConfig.Config>; }
        catch { return null; }
        return withDefaults( parsed );
    }

    /** Serialize a Config back to the SAME pretty-printed form the JSON editor uses (2-space indent). */
    export function stringify( config : AuthConfig.Config ) : string
    {
        return JSON.stringify( config, null, 2 );
    }

    /** Fill any missing top-level/nested section from AuthConfig.DEFAULT — tolerates an older/partial config. */
    function withDefaults( parsed : Partial<AuthConfig.Config> ) : AuthConfig.Config
    {
        const fallback : AuthConfig.Config = AuthConfig.DEFAULT;
        return {
            lockout: { ...fallback.lockout, ...parsed.lockout },
            mfa: { ...fallback.mfa, ...parsed.mfa },
            tokens: { ...fallback.tokens, ...parsed.tokens },
            verification: { ...fallback.verification, ...parsed.verification },
            webauthn: { ...fallback.webauthn, ...parsed.webauthn },
            abuse: {
                ...fallback.abuse, ...parsed.abuse,
                login: { ...fallback.abuse.login, ...parsed.abuse?.login },
                register: { ...fallback.abuse.register, ...parsed.abuse?.register },
                reset: { ...fallback.abuse.reset, ...parsed.abuse?.reset },
                resend: { ...fallback.abuse.resend, ...parsed.abuse?.resend },
            },
            sso: { ...fallback.sso, ...parsed.sso },
            logLevel: parsed.logLevel ?? fallback.logLevel,
        };
    }
}

export default AuthConfigFormModel;
