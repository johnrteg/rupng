import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { Registration, RegistrationConfig, Billing, LogLevel } from "@repo/api";
import { RegistrationConfigFormModel } from "./RegistrationConfigFormModel";
import { CspSection } from "./CspSection";
import { CarrierProviderSection } from "./CarrierProviderSection";
import { FeeTablesSection } from "./FeeTablesSection";
import { ProvisioningSection } from "./ProvisioningSection";
import { PollSweepSection } from "./PollSweepSection";
import { LoggingSection } from "../configEditor/LoggingSection";

//
// RegistrationConfigForm — the "smart" alternative to the raw JSON editor for the registration service's
// `settings` config. Mirrors voiceConfig/VoiceConfigForm.tsx: one section per RegistrationConfig.Config
// concern, plain text fields for secret REFERENCES, a repeating-row editor for the carrier-provider registry,
// and per-enum-key fee tables. Reads/writes the SAME JSON text the JSON editor shows.
//
// IMPORTANT: any new field added to RegistrationConfig.Config
// (packages/api/src/registration/model/RegistrationConfig.ts) needs a matching control added here — see
// CLAUDE.md's "Models & closed sets" note.
//

/** The smart, form-based editor for the registration service's `settings` AppConfig profile. */
export function RegistrationConfigForm( props : RegistrationConfigForm.Props )
{
    const config : RegistrationConfig.Config | null = RegistrationConfigFormModel.parse( props.content );

    if ( !config )
        return (
            <Box sx={{ p: 2 }}>
                <Typography variant="body2" sx={{ color: "error.main" }}>
                    Current content isn't valid JSON — switch to the JSON editor to fix it before using the smart editor.
                </Typography>
            </Box>
        );

    /** Commit an updated field back into the full config, re-serialize, and notify ConfigPanel. */
    function update<Key extends keyof RegistrationConfig.Config>( key : Key, value : RegistrationConfig.Config[ Key ] ) : void
    {
        const next : RegistrationConfig.Config = { ...( config as RegistrationConfig.Config ), [ key ]: value };
        props.onChange( RegistrationConfigFormModel.stringify( next ) );
    }

    return (
        <Box sx={{ p: 1.5, overflowY: "auto", height: "100%" }}>
            <CspSection
                cspId={config.cspId} resellerId={config.resellerId} secretRef={config.secretRef} cvSecretRef={config.cvSecretRef} readOnly={props.readOnly}
                onChangeCspId={( value : string ) : void => update( "cspId", value )}
                onChangeResellerId={( value : string ) : void => update( "resellerId", value )}
                onChangeSecretRef={( value : string ) : void => update( "secretRef", value )}
                onChangeCvSecretRef={( value : string | undefined ) : void => update( "cvSecretRef", value )}
            />
            <CarrierProviderSection
                value={config.providers} readOnly={props.readOnly}
                onChange={( value : Record<string, RegistrationConfig.ProviderEntry> ) : void => update( "providers", value )}
            />
            <FeeTablesSection
                useCaseMonthlyFee={config.useCaseMonthlyFee} vettingFee={config.vettingFee} defaultVettingFee={config.defaultVettingFee} readOnly={props.readOnly}
                onChangeUseCaseMonthlyFee={( value : Partial<Record<Registration.UseCase, Billing.Rate>> ) : void => update( "useCaseMonthlyFee", value )}
                onChangeVettingFee={( value : Partial<Record<Registration.VettingProvider, Billing.Rate>> ) : void => update( "vettingFee", value )}
                onChangeDefaultVettingFee={( value : Billing.Rate ) : void => update( "defaultVettingFee", value )}
            />
            <ProvisioningSection
                maxLinesPerCampaign={config.maxLinesPerCampaign} reuseGraceDays={config.reuseGraceDays} defaultAreaCode={config.defaultAreaCode} readOnly={props.readOnly}
                onChangeMaxLinesPerCampaign={( value : number ) : void => update( "maxLinesPerCampaign", value )}
                onChangeReuseGraceDays={( value : number ) : void => update( "reuseGraceDays", value )}
                onChangeDefaultAreaCode={( value : string | undefined ) : void => update( "defaultAreaCode", value )}
            />
            <PollSweepSection value={config.pollSweep} readOnly={props.readOnly} onChange={( value : RegistrationConfig.PollSweep ) : void => update( "pollSweep", value )} />
            <LoggingSection value={config.logLevel ?? LogLevel.INFO} readOnly={props.readOnly} onChange={( value : LogLevel ) : void => update( "logLevel", value )} />
        </Box>
    );
}

export namespace RegistrationConfigForm
{
    export interface Props
    {
        content  : string;
        onChange : ( content : string ) => void;
        readOnly : boolean;
    }
}

export default RegistrationConfigForm;
