import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { SocialConfig, LogLevel } from "@repo/api";
import { SocialConfigFormModel } from "./SocialConfigFormModel";
import { PollSection } from "./PollSection";
import { ApprovalsSection } from "./ApprovalsSection";
import { QuotaSection } from "./QuotaSection";
import { LoggingSection } from "../configEditor/LoggingSection";

//
// SocialConfigForm — the "smart" alternative to the raw JSON editor for the social service's
// `settings` config. Mirrors emailConfig/EmailConfigForm.tsx: one section per SocialConfig.Config
// concern. Reads/writes the SAME JSON text the JSON editor shows.
//
// IMPORTANT: any new field added to SocialConfig.Config (packages/api/src/social/model/SocialConfig.ts)
// needs a matching control added here — see CLAUDE.md's "Models & closed sets" note.
//

/** The smart, form-based editor for the social service's `settings` AppConfig profile. */
export function SocialConfigForm( props : SocialConfigForm.Props )
{
    const config : SocialConfig.Config | null = SocialConfigFormModel.parse( props.content );

    if ( !config )
        return (
            <Box sx={{ p: 2 }}>
                <Typography variant="body2" sx={{ color: "error.main" }}>
                    Current content isn't valid JSON — switch to the JSON editor to fix it before using the smart editor.
                </Typography>
            </Box>
        );

    /** Commit an updated section back into the full config, re-serialize, and notify ConfigPanel. */
    function update<Key extends keyof SocialConfig.Config>( key : Key, value : SocialConfig.Config[ Key ] ) : void
    {
        const next : SocialConfig.Config = { ...( config as SocialConfig.Config ), [ key ]: value };
        props.onChange( SocialConfigFormModel.stringify( next ) );
    }

    return (
        <Box sx={{ p: 1.5, overflowY: "auto", height: "100%" }}>
            <PollSection
                poll={config.poll} refresh={config.refresh} readOnly={props.readOnly}
                onPollChange={( value : SocialConfig.Poll ) : void => update( "poll", value )}
                onRefreshChange={( value : SocialConfig.Refresh ) : void => update( "refresh", value )}
            />
            <ApprovalsSection value={config.approvals} readOnly={props.readOnly} onChange={( value : SocialConfig.Approvals ) : void => update( "approvals", value )} />
            <QuotaSection value={config.maxProfiles} readOnly={props.readOnly} onChange={( value ) : void => update( "maxProfiles", value )} />
            <LoggingSection value={config.logLevel ?? LogLevel.INFO} readOnly={props.readOnly} onChange={( value : LogLevel ) : void => update( "logLevel", value )} />
        </Box>
    );
}

export namespace SocialConfigForm
{
    export interface Props
    {
        content  : string;
        onChange : ( content : string ) => void;
        readOnly : boolean;
    }
}

export default SocialConfigForm;
