import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { ReportConfig, LogLevel } from "@repo/api";
import { ReportConfigFormModel } from "./ReportConfigFormModel";
import { GeneralSection } from "./GeneralSection";
import { LoggingSection } from "../configEditor/LoggingSection";

//
// ReportConfigForm — the "smart" alternative to the raw JSON editor for the report service's `settings`
// config. Mirrors voiceConfig/VoiceConfigForm.tsx: one section per ReportConfig.Config concern, a
// range-clamped numeric input for retention + the shared log-level picker. Reads/writes the SAME JSON text
// the JSON editor shows.
//
// IMPORTANT: any new field added to ReportConfig.Config (packages/api/src/report/model/ReportConfig.ts)
// needs a matching control added here — see CLAUDE.md's "Models & closed sets" note.
//

/** The smart, form-based editor for the report service's `settings` AppConfig profile. */
export function ReportConfigForm( props : ReportConfigForm.Props )
{
    const config : ReportConfig.Config | null = ReportConfigFormModel.parse( props.content );

    if ( !config )
        return (
            <Box sx={{ p: 2 }}>
                <Typography variant="body2" sx={{ color: "error.main" }}>
                    Current content isn't valid JSON — switch to the JSON editor to fix it before using the smart editor.
                </Typography>
            </Box>
        );

    /** Commit an updated field back into the full config, re-serialize, and notify ConfigPanel. */
    function update<Key extends keyof ReportConfig.Config>( key : Key, value : ReportConfig.Config[ Key ] ) : void
    {
        const next : ReportConfig.Config = { ...( config as ReportConfig.Config ), [ key ]: value };
        props.onChange( ReportConfigFormModel.stringify( next ) );
    }

    return (
        <Box sx={{ p: 1.5, overflowY: "auto", height: "100%" }}>
            <GeneralSection
                retentionDays={config.retentionDays} readOnly={props.readOnly}
                onChangeRetentionDays={( value : number ) : void => update( "retentionDays", value )}
            />
            <LoggingSection value={config.logLevel ?? LogLevel.INFO} readOnly={props.readOnly} onChange={( value : LogLevel ) : void => update( "logLevel", value )} />
        </Box>
    );
}

export namespace ReportConfigForm
{
    export interface Props
    {
        content  : string;
        onChange : ( content : string ) => void;
        readOnly : boolean;
    }
}

export default ReportConfigForm;
