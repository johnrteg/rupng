import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { Voice, VoiceConfig, LogLevel } from "@repo/api";
import { VoiceConfigFormModel } from "./VoiceConfigFormModel";
import { GeneralSection } from "./GeneralSection";
import { LimitsSection } from "./LimitsSection";
import { QuietHoursSection } from "./QuietHoursSection";
import { ProviderRegistrySection } from "./ProviderRegistrySection";
import { LoggingSection } from "../configEditor/LoggingSection";

//
// VoiceConfigForm — the "smart" alternative to the raw JSON editor for the voice service's `settings` config.
// Mirrors emailConfig/EmailConfigForm.tsx: one section per VoiceConfig.Config concern, a select for the
// provider enum, range-clamped numeric inputs, and a repeating-row editor for the provider registry. Reads/
// writes the SAME JSON text the JSON editor shows.
//
// IMPORTANT: any new field added to VoiceConfig.Config (packages/api/src/voice/model/VoiceConfig.ts) needs a
// matching control added here — see CLAUDE.md's "Models & closed sets" note.
//

/** The smart, form-based editor for the voice service's `settings` AppConfig profile. */
export function VoiceConfigForm( props : VoiceConfigForm.Props )
{
    const config : VoiceConfig.Config | null = VoiceConfigFormModel.parse( props.content );

    if ( !config )
        return (
            <Box sx={{ p: 2 }}>
                <Typography variant="body2" sx={{ color: "error.main" }}>
                    Current content isn't valid JSON — switch to the JSON editor to fix it before using the smart editor.
                </Typography>
            </Box>
        );

    /** Commit an updated section back into the full config, re-serialize, and notify ConfigPanel. */
    function update<Key extends keyof VoiceConfig.Config>( key : Key, value : VoiceConfig.Config[ Key ] ) : void
    {
        const next : VoiceConfig.Config = { ...( config as VoiceConfig.Config ), [ key ]: value };
        props.onChange( VoiceConfigFormModel.stringify( next ) );
    }

    return (
        <Box sx={{ p: 1.5, overflowY: "auto", height: "100%" }}>
            <GeneralSection
                provider={config.defaultProvider} recordingEnabled={config.recordingEnabled} transcriptionEnabled={config.transcriptionEnabled} amdEnabled={config.amdEnabled} readOnly={props.readOnly}
                onChangeProvider={( value : Voice.Provider ) : void => update( "defaultProvider", value )}
                onChangeRecordingEnabled={( value : boolean ) : void => update( "recordingEnabled", value )}
                onChangeTranscriptionEnabled={( value : boolean ) : void => update( "transcriptionEnabled", value )}
                onChangeAmdEnabled={( value : boolean ) : void => update( "amdEnabled", value )}
            />
            <LimitsSection value={config.limits} readOnly={props.readOnly} onChange={( value : VoiceConfig.Limits ) : void => update( "limits", value )} />
            <QuietHoursSection value={config.quietHours} readOnly={props.readOnly} onChange={( value : VoiceConfig.QuietHours ) : void => update( "quietHours", value )} />
            <ProviderRegistrySection value={config.providers} readOnly={props.readOnly} onChange={( value : Record<string, VoiceConfig.ProviderEntry> ) : void => update( "providers", value )} />
            <LoggingSection value={config.logLevel ?? LogLevel.INFO} readOnly={props.readOnly} onChange={( value : LogLevel ) : void => update( "logLevel", value )} />
        </Box>
    );
}

export namespace VoiceConfigForm
{
    export interface Props
    {
        content  : string;
        onChange : ( content : string ) => void;
        readOnly : boolean;
    }
}

export default VoiceConfigForm;
