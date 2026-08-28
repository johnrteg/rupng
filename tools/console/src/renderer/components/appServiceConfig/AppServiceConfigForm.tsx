import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { AppServiceConfig, LogLevel } from "@repo/api";
import { AppServiceConfigFormModel } from "./AppServiceConfigFormModel";
import { LoggingSection } from "../configEditor/LoggingSection";

//
// AppServiceConfigForm — the "smart" alternative to the raw JSON editor for the app service's INTERNAL
// `settings` profile (AppServiceConfig.Config) — distinct from `AppBootstrapForm`, which edits the PUBLIC
// `web` profile (GetBootstrap.Config). Today `settings` is just the dynamic log level; add a section here
// (see mediaConfig/MediaConfigForm.tsx for the pattern) as this profile grows more ops tunables.
//
// IMPORTANT: any new field added to AppServiceConfig.Config
// (packages/api/src/app/model/AppServiceConfig.ts) needs a matching control added here — see CLAUDE.md's
// "Models & closed sets" note.
//

/** The smart, form-based editor for the app service's `settings` AppConfig profile. */
export function AppServiceConfigForm( props : AppServiceConfigForm.Props )
{
    const config : AppServiceConfig.Config | null = AppServiceConfigFormModel.parse( props.content );

    if ( !config )
        return (
            <Box sx={{ p: 2 }}>
                <Typography variant="body2" sx={{ color: "error.main" }}>
                    Current content isn't valid JSON — switch to the JSON editor to fix it before using the smart editor.
                </Typography>
            </Box>
        );

    return (
        <Box sx={{ p: 1.5, overflowY: "auto", height: "100%" }}>
            <LoggingSection
                value={config.logLevel ?? LogLevel.INFO} readOnly={props.readOnly}
                onChange={( value : LogLevel ) : void => props.onChange( AppServiceConfigFormModel.stringify( { ...config, logLevel: value } ) )}
            />
        </Box>
    );
}

export namespace AppServiceConfigForm
{
    export interface Props
    {
        content  : string;
        onChange : ( content : string ) => void;
        readOnly : boolean;
    }
}

export default AppServiceConfigForm;
