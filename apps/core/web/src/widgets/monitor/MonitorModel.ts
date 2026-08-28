import { MonitorConfig, MonitorWidgetStatus } from "@repo/api";

//
// MonitorModel — shared types for the monitor dashboard widgets. Mirrors the shape of
// widgets/svg/SvgEditorModel.ts: plain types + pure helpers, no components here.
//

export namespace MonitorModel
{
    /** One tile's view state — the configured widget plus its last successful/attempted read. */
    export interface TileState
    {
        widget  : MonitorConfig.WidgetConfig;
        data?   : MonitorWidgetStatus.Data;
        loading : boolean;
    }

    /** Display metadata for a widget type — icon key + human label, looked up by `MonitorWidgetTile`. */
    export interface TypeMeta { label : string; }

    export const TYPE_META : Record<MonitorConfig.WidgetType, TypeMeta> =
    {
        [ MonitorConfig.WidgetType.DYNAMO_TABLE ]: { label: "DynamoDB table" },
        [ MonitorConfig.WidgetType.SQS_QUEUE ]:    { label: "SQS queue" },
        [ MonitorConfig.WidgetType.ECS_SERVICE ]:  { label: "ECS service" },
        [ MonitorConfig.WidgetType.LAMBDA_JOB ]:   { label: "Lambda job" },
        [ MonitorConfig.WidgetType.API_TARGET ]:   { label: "API target" },
    };

    /** The tile's status color — a theme palette token, never a hard-coded color. */
    export function paletteFor( level : MonitorWidgetStatus.Level | undefined ) : "success.main" | "warning.main" | "error.main" | "text.secondary"
    {
        switch( level )
        {
            case MonitorWidgetStatus.Level.OK:       return "success.main";
            case MonitorWidgetStatus.Level.WARN:     return "warning.main";
            case MonitorWidgetStatus.Level.CRITICAL: return "error.main";
            case MonitorWidgetStatus.Level.ERROR:    return "error.main";
            default:                                 return "text.secondary";
        }
    }
}

export default MonitorModel;
