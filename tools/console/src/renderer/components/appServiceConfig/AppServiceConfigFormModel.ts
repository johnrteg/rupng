import { AppServiceConfig } from "@repo/api";

//
// AppServiceConfigFormModel — pure parse/merge helpers shared by AppServiceConfigForm. Mirrors
// mediaConfig/MediaConfigFormModel.ts (same rationale: no @repo/common dependency in tools/console, so a
// small explicit merge stands in for `ObjectUtils.withDefaults`).
//

export namespace AppServiceConfigFormModel
{
    /** Parse `content` as an AppServiceConfig.Config, filling any missing field from
     *  AppServiceConfig.DEFAULT. Returns null when the text isn't valid JSON. */
    export function parse( content : string ) : AppServiceConfig.Config | null
    {
        if ( content.trim() === "" ) return AppServiceConfig.DEFAULT;
        let parsed : Partial<AppServiceConfig.Config>;
        try { parsed = JSON.parse( content ) as Partial<AppServiceConfig.Config>; }
        catch { return null; }
        return { ...AppServiceConfig.DEFAULT, ...parsed };
    }

    /** Serialize a Config back to the SAME pretty-printed form the JSON editor uses (2-space indent). */
    export function stringify( config : AppServiceConfig.Config ) : string
    {
        return JSON.stringify( config, null, 2 );
    }
}

export default AppServiceConfigFormModel;
