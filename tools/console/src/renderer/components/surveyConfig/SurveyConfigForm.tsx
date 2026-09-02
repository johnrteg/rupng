import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import { SurveyConfig, LogLevel } from "@repo/api";
import { SurveyConfigFormModel } from "./SurveyConfigFormModel";
import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";
import { LoggingSection } from "../configEditor/LoggingSection";

//
// SurveyConfigForm — the "smart" alternative to the raw JSON editor for the survey service's `settings`
// config: the account-default anonymity flag + the partial-response/abandonment policy (survey-4.4/4.3).
// Reads/writes the SAME JSON text the JSON editor shows.
//
// IMPORTANT: any new field added to SurveyConfig.Config (packages/api/src/survey/model/SurveyConfig.ts)
// needs a matching control added here — see CLAUDE.md's "Models & closed sets" note.
//

/** The smart, form-based editor for the survey service's `settings` AppConfig profile. */
export function SurveyConfigForm( props : SurveyConfigForm.Props )
{
    const config : SurveyConfig.Config | null = SurveyConfigFormModel.parse( props.content );

    if ( !config )
        return (
            <Box sx={{ p: 2 }}>
                <Typography variant="body2" sx={{ color: "error.main" }}>
                    Current content isn't valid JSON — switch to the JSON editor to fix it before using the smart editor.
                </Typography>
            </Box>
        );

    /** Commit an updated field back into the full config, re-serialize, and notify ConfigPanel. */
    function update<Key extends keyof SurveyConfig.Config>( key : Key, value : SurveyConfig.Config[ Key ] ) : void
    {
        const next : SurveyConfig.Config = { ...( config as SurveyConfig.Config ), [ key ]: value };
        props.onChange( SurveyConfigFormModel.stringify( next ) );
    }

    return (
        <Box sx={{ p: 1.5, overflowY: "auto", height: "100%" }}>
            <ConfigSection title="Response identity" hint="Per-send `anonymous` still overrides this — survey-4.4.">
                <FormControlLabel
                    control={<Switch checked={config.anonymousDefault} disabled={props.readOnly} onChange={( event ) : void => update( "anonymousDefault", event.target.checked )} />}
                    label="Anonymous by default (no contact link / no per-contact scoring)"
                />
            </ConfigSection>
            <ConfigSection title="Partials & abandonment" hint="survey-4.3 — when an in-progress response is considered abandoned, and how long a partial is kept.">
                <RangeNumberField label="Abandonment timeout (minutes)" min={1} max={10080} value={config.abandonmentTimeoutMinutes} disabled={props.readOnly} onChange={( value : number ) : void => update( "abandonmentTimeoutMinutes", value )} />
                <RangeNumberField label="Partial retention (days)" min={1} max={365} value={config.partialRetentionDays} disabled={props.readOnly} onChange={( value : number ) : void => update( "partialRetentionDays", value )} />
            </ConfigSection>
            <LoggingSection value={config.logLevel ?? LogLevel.INFO} readOnly={props.readOnly} onChange={( value : LogLevel ) : void => update( "logLevel", value )} />
        </Box>
    );
}

export namespace SurveyConfigForm
{
    export interface Props
    {
        content  : string;
        onChange : ( content : string ) => void;
        readOnly : boolean;
    }
}

export default SurveyConfigForm;
