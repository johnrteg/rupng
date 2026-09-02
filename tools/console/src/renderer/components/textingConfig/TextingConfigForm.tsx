import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { TextingConfig, LogLevel } from "@repo/api";
import { TextingConfigFormModel } from "./TextingConfigFormModel";
import { ProvidersSection } from "./ProvidersSection";
import { ProviderRegistrySection } from "./ProviderRegistrySection";
import { LoggingSection } from "../configEditor/LoggingSection";

//
// TextingConfigForm — the "smart" alternative to the raw JSON editor for the texting service's `settings`
// config. Mirrors emailConfig/EmailConfigForm.tsx: one section per TextingConfig.Config concern. Reads/
// writes the SAME JSON text the JSON editor shows.
//
// IMPORTANT: any new field added to TextingConfig.Config (packages/api/src/texting/model/TextingConfig.ts)
// needs a matching control added here — see CLAUDE.md's "Models & closed sets" note.
//

/** The smart, form-based editor for the texting service's `settings` AppConfig profile. */
export function TextingConfigForm( props : TextingConfigForm.Props )
{
    const config : TextingConfig.Config | null = TextingConfigFormModel.parse( props.content );

    if ( !config )
        return (
            <Box sx={{ p: 2 }}>
                <Typography variant="body2" sx={{ color: "error.main" }}>
                    Current content isn't valid JSON — switch to the JSON editor to fix it before using the smart editor.
                </Typography>
            </Box>
        );

    /** Commit an updated section back into the full config, re-serialize, and notify ConfigPanel. */
    function update<Key extends keyof TextingConfig.Config>( key : Key, value : TextingConfig.Config[ Key ] ) : void
    {
        const next : TextingConfig.Config = { ...( config as TextingConfig.Config ), [ key ]: value };
        props.onChange( TextingConfigFormModel.stringify( next ) );
    }

    return (
        <Box sx={{ p: 1.5, overflowY: "auto", height: "100%" }}>
            <ProvidersSection value={config} readOnly={props.readOnly} onChange={( value : TextingConfig.Config ) : void => props.onChange( TextingConfigFormModel.stringify( value ) )} />
            <ProviderRegistrySection value={config.providers} readOnly={props.readOnly} onChange={( value : Record<string, TextingConfig.ProviderEntry> ) : void => update( "providers", value )} />
            <LoggingSection value={config.logLevel ?? LogLevel.INFO} readOnly={props.readOnly} onChange={( value : LogLevel ) : void => update( "logLevel", value )} />
        </Box>
    );
}

export namespace TextingConfigForm
{
    export interface Props
    {
        content  : string;
        onChange : ( content : string ) => void;
        readOnly : boolean;
    }
}

export default TextingConfigForm;
