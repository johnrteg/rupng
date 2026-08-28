import { GetBootstrap } from "@repo/api";

//
// AppBootstrapFormModel — pure parse/merge helpers shared by AppBootstrapForm's sections. Mirrors
// mediaConfig/MediaConfigFormModel.ts (same rationale: no @repo/common dependency in tools/console, so a
// small explicit per-section merge stands in for `ObjectUtils.withDefaults`).
//
// NOTE: this edits the `app` service's `web` AppConfig profile (GetBootstrap.Config/Response) — a PUBLIC,
// unauthenticated bootstrap blob served to every browser on load. See CLAUDE.md / AppBootstrapForm.tsx for
// why `notices` stays JSON-only and why this editor has no Logging section.
//

export namespace AppBootstrapFormModel
{
    /** Parse `content` as a GetBootstrap.Config, filling any missing section from GetBootstrap.DEFAULT so an
     *  older/partial config still renders. Returns null when the text isn't valid JSON. */
    export function parse( content : string ) : GetBootstrap.Config | null
    {
        if ( content.trim() === "" ) return GetBootstrap.DEFAULT;
        let parsed : Partial<GetBootstrap.Config>;
        try { parsed = JSON.parse( content ) as Partial<GetBootstrap.Config>; }
        catch { return null; }
        return withDefaults( parsed );
    }

    /** Serialize a Config back to the SAME pretty-printed form the JSON editor uses (2-space indent). */
    export function stringify( config : GetBootstrap.Config ) : string
    {
        return JSON.stringify( config, null, 2 );
    }

    /** Fill any missing top-level/nested section from GetBootstrap.DEFAULT — tolerates an older/partial config. */
    function withDefaults( parsed : Partial<GetBootstrap.Config> ) : GetBootstrap.Config
    {
        const fallback : GetBootstrap.Config = GetBootstrap.DEFAULT;
        return {
            branding: { ...fallback.branding, ...parsed.branding },
            name: parsed.name ?? fallback.name,
            passwordPolicy: { ...fallback.passwordPolicy, ...parsed.passwordPolicy },
            uploadLimits: { ...fallback.uploadLimits, ...parsed.uploadLimits },
            publishableKeys: { ...fallback.publishableKeys, ...parsed.publishableKeys },
            featureFlags: parsed.featureFlags ?? fallback.featureFlags,
            notices: parsed.notices ?? fallback.notices,
            countries: parsed.countries ?? fallback.countries,
            country: parsed.country ?? fallback.country,
            session: { ...fallback.session, ...parsed.session },
        };
    }
}

export default AppBootstrapFormModel;
