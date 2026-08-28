import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { MonitorConfig, LogLevel } from "@repo/api";
import { MonitorConfigFormModel } from "./MonitorConfigFormModel";
import { WidgetsSection } from "./WidgetsSection";
import { LoggingSection } from "../configEditor/LoggingSection";

//
// MonitorConfigForm — the "smart" alternative to the raw JSON editor for the monitor service's
// `settings` config. Mirrors socialConfig/SocialConfigForm.tsx. Reads/writes the SAME JSON text
// the JSON editor shows.
//
// IMPORTANT: any new field added to MonitorConfig.Config (packages/api/src/monitor/model/MonitorConfig.ts)
// needs a matching control added here — see CLAUDE.md's "Models & closed sets" note.
//

/** The smart, form-based editor for the monitor service's `settings` AppConfig profile. */
export function MonitorConfigForm( props : MonitorConfigForm.Props )
{
    const config : MonitorConfig.Config | null = MonitorConfigFormModel.parse( props.content );

    if ( !config )
        return (
            <Box sx={{ p: 2 }}>
                <Typography variant="body2" sx={{ color: "error.main" }}>
                    Current content isn't valid JSON — switch to the JSON editor to fix it before using the smart editor.
                </Typography>
            </Box>
        );

    /** Commit an updated field back into the full config, re-serialize, and notify ConfigPanel. */
    function update<Key extends keyof MonitorConfig.Config>( key : Key, value : MonitorConfig.Config[ Key ] ) : void
    {
        const next : MonitorConfig.Config = { ...( config as MonitorConfig.Config ), [ key ]: value };
        props.onChange( MonitorConfigFormModel.stringify( next ) );
    }

    return (
        <Box sx={{ p: 1.5, overflowY: "auto", height: "100%" }}>
            <WidgetsSection value={config.widgets} readOnly={props.readOnly} onChange={( value : Array<MonitorConfig.WidgetConfig> ) : void => update( "widgets", value )} />
            <LoggingSection value={config.logLevel ?? LogLevel.INFO} readOnly={props.readOnly} onChange={( value : LogLevel ) : void => update( "logLevel", value )} />
        </Box>
    );
}

export namespace MonitorConfigForm
{
    export interface Props
    {
        content  : string;
        onChange : ( content : string ) => void;
        readOnly : boolean;
    }
}

export default MonitorConfigForm;
