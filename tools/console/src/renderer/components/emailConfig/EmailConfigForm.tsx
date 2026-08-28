import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { Email, EmailConfig, LogLevel } from "@repo/api";
import { EmailConfigFormModel } from "./EmailConfigFormModel";
import { ProvidersSection } from "./ProvidersSection";
import { SystemSendersSection } from "./SystemSendersSection";
import { SystemSenderRoutingSection } from "./SystemSenderRoutingSection";
import { LimitsSection } from "./LimitsSection";
import { SchedulingSection } from "./SchedulingSection";
import { ProviderRegistrySection } from "./ProviderRegistrySection";
import { WebFontsSection, type WebFont } from "./WebFontsSection";
import { LoggingSection } from "../configEditor/LoggingSection";

//
// EmailConfigForm — the "smart" alternative to the raw JSON editor for the email service's `settings`
// config. Mirrors mediaConfig/MediaConfigForm.tsx: one section per EmailConfig.Config concern, selects for
// enums, range-clamped numeric inputs, repeating-row editors for the named collections (system senders,
// sender routing, the provider registry, web fonts). Reads/writes the SAME JSON text the JSON editor shows.
//
// IMPORTANT: any new field added to EmailConfig.Config (packages/api/src/email/model/EmailConfig.ts) needs
// a matching control added here — see CLAUDE.md's "Models & closed sets" note.
//

/** The smart, form-based editor for the email service's `settings` AppConfig profile. */
export function EmailConfigForm( props : EmailConfigForm.Props )
{
    const config : EmailConfig.Config | null = EmailConfigFormModel.parse( props.content );

    if ( !config )
        return (
            <Box sx={{ p: 2 }}>
                <Typography variant="body2" sx={{ color: "error.main" }}>
                    Current content isn't valid JSON — switch to the JSON editor to fix it before using the smart editor.
                </Typography>
            </Box>
        );

    /** Commit an updated section back into the full config, re-serialize, and notify ConfigPanel. */
    function update<Key extends keyof EmailConfig.Config>( key : Key, value : EmailConfig.Config[ Key ] ) : void
    {
        const next : EmailConfig.Config = { ...( config as EmailConfig.Config ), [ key ]: value };
        props.onChange( EmailConfigFormModel.stringify( next ) );
    }

    const senderKeys : Array<string> = config.systemSenders.map( ( sender : Email.Sender ) : string => sender.key );

    return (
        <Box sx={{ p: 1.5, overflowY: "auto", height: "100%" }}>
            <ProvidersSection value={config} readOnly={props.readOnly} onChange={( value : EmailConfig.Config ) : void => props.onChange( EmailConfigFormModel.stringify( value ) )} />
            <SystemSendersSection value={config} readOnly={props.readOnly} onChange={( value : EmailConfig.Config ) : void => props.onChange( EmailConfigFormModel.stringify( value ) )} />
            <SystemSenderRoutingSection
                value={config.systemSenderRouting} senderKeys={senderKeys} readOnly={props.readOnly}
                onChange={( value : Partial<Record<Email.NotificationType, string>> ) : void => update( "systemSenderRouting", value )}
            />
            <LimitsSection value={config.limits} readOnly={props.readOnly} onChange={( value : EmailConfig.Limits ) : void => update( "limits", value )} />
            <SchedulingSection value={config.scheduling} readOnly={props.readOnly} onChange={( value : EmailConfig.Scheduling ) : void => update( "scheduling", value )} />
            <ProviderRegistrySection value={config.providers} readOnly={props.readOnly} onChange={( value : Record<string, EmailConfig.ProviderEntry> ) : void => update( "providers", value )} />
            <WebFontsSection value={config.webFonts} readOnly={props.readOnly} onChange={( value : Array<WebFont> ) : void => update( "webFonts", value )} />
            <LoggingSection value={config.logLevel ?? LogLevel.INFO} readOnly={props.readOnly} onChange={( value : LogLevel ) : void => update( "logLevel", value )} />
        </Box>
    );
}

export namespace EmailConfigForm
{
    export interface Props
    {
        content  : string;
        onChange : ( content : string ) => void;
        readOnly : boolean;
    }
}

export default EmailConfigForm;
