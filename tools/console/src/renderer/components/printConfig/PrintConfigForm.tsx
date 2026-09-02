import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { Print, PrintConfig, LogLevel } from "@repo/api";
import { PrintConfigFormModel } from "./PrintConfigFormModel";
import { GeneralSection } from "./GeneralSection";
import { LimitsSection } from "./LimitsSection";
import { ProviderRegistrySection } from "./ProviderRegistrySection";
import { VerifierRegistrySection } from "./VerifierRegistrySection";
import { LoggingSection } from "../configEditor/LoggingSection";

//
// PrintConfigForm — the "smart" alternative to the raw JSON editor for the print service's `settings` config.
// Mirrors voiceConfig/VoiceConfigForm.tsx: one section per PrintConfig.Config concern. TWO independent
// repeating-row registries (mail-fulfillment providers vs address-verification sources — print-2.6), since
// print keeps them as separate typed factories. Reads/writes the SAME JSON text the JSON editor shows.
//
// IMPORTANT: any new field added to PrintConfig.Config (packages/api/src/print/model/PrintConfig.ts) needs a
// matching control added here — see CLAUDE.md's "Models & closed sets" note.
//

/** The smart, form-based editor for the print service's `settings` AppConfig profile. */
export function PrintConfigForm( props : PrintConfigForm.Props )
{
    const config : PrintConfig.Config | null = PrintConfigFormModel.parse( props.content );

    if ( !config )
        return (
            <Box sx={{ p: 2 }}>
                <Typography variant="body2" sx={{ color: "error.main" }}>
                    Current content isn't valid JSON — switch to the JSON editor to fix it before using the smart editor.
                </Typography>
            </Box>
        );

    /** Commit an updated section back into the full config, re-serialize, and notify ConfigPanel. */
    function update<Key extends keyof PrintConfig.Config>( key : Key, value : PrintConfig.Config[ Key ] ) : void
    {
        const next : PrintConfig.Config = { ...( config as PrintConfig.Config ), [ key ]: value };
        props.onChange( PrintConfigFormModel.stringify( next ) );
    }

    return (
        <Box sx={{ p: 1.5, overflowY: "auto", height: "100%" }}>
            <GeneralSection
                provider={config.defaultProvider} verifier={config.defaultAddressVerifier} mailClass={config.defaultMailClass}
                ncoaMaxAgeDays={config.ncoaMaxAgeDays} readOnly={props.readOnly}
                onChangeProvider={( value : Print.Provider ) : void => update( "defaultProvider", value )}
                onChangeVerifier={( value : Print.AddressVerifierId ) : void => update( "defaultAddressVerifier", value )}
                onChangeMailClass={( value : Print.MailClass ) : void => update( "defaultMailClass", value )}
                onChangeNcoaMaxAgeDays={( value : number ) : void => update( "ncoaMaxAgeDays", value )}
            />
            <LimitsSection value={config.limits} readOnly={props.readOnly} onChange={( value : PrintConfig.Limits ) : void => update( "limits", value )} />
            <ProviderRegistrySection value={config.providers} readOnly={props.readOnly} onChange={( value : Record<string, PrintConfig.ProviderEntry> ) : void => update( "providers", value )} />
            <VerifierRegistrySection value={config.addressVerifiers} readOnly={props.readOnly} onChange={( value : Record<string, PrintConfig.VerifierEntry> ) : void => update( "addressVerifiers", value )} />
            <LoggingSection value={config.logLevel ?? LogLevel.INFO} readOnly={props.readOnly} onChange={( value : LogLevel ) : void => update( "logLevel", value )} />
        </Box>
    );
}

export namespace PrintConfigForm
{
    export interface Props
    {
        content  : string;
        onChange : ( content : string ) => void;
        readOnly : boolean;
    }
}

export default PrintConfigForm;
