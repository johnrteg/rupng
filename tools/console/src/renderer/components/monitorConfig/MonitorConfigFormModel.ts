import { MonitorConfig } from "@repo/api";

//
// MonitorConfigFormModel — pure parse/merge helpers shared by MonitorConfigForm's sections. Mirrors
// socialConfig/SocialConfigFormModel.ts (no @repo/common dependency in tools/console, so a small
// explicit merge stands in for `ObjectUtils.withDefaults`).
//

export namespace MonitorConfigFormModel
{
    /** Parse `content` as a MonitorConfig.Config, filling any missing field from MonitorConfig.DEFAULT
     *  so an older/partial config still renders. Returns null when the text isn't valid JSON. */
    export function parse( content : string ) : MonitorConfig.Config | null
    {
        if ( content.trim() === "" ) return MonitorConfig.DEFAULT;
        let parsed : Partial<MonitorConfig.Config>;
        try { parsed = JSON.parse( content ) as Partial<MonitorConfig.Config>; }
        catch { return null; }
        return {
            widgets:  parsed.widgets ?? MonitorConfig.DEFAULT.widgets,
            logLevel: parsed.logLevel ?? MonitorConfig.DEFAULT.logLevel,
        };
    }

    /** Serialize a Config back to the SAME pretty-printed form the JSON editor uses (2-space indent). */
    export function stringify( config : MonitorConfig.Config ) : string
    {
        return JSON.stringify( config, null, 2 );
    }

    /** A fresh, empty widget row — a random id + sane starting defaults, ready for the operator to fill in. */
    export function blankWidget() : MonitorConfig.WidgetConfig
    {
        return { id: crypto.randomUUID(), type: MonitorConfig.WidgetType.SQS_QUEUE, label: "", target: "", refreshIntervalSec: 30 };
    }
}

export default MonitorConfigFormModel;
