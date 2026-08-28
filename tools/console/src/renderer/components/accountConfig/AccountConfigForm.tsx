import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { AccountConfig, LogLevel } from "@repo/api";
import { AccountConfigFormModel } from "./AccountConfigFormModel";
import { HierarchySection } from "./HierarchySection";
import { MembershipSection } from "./MembershipSection";
import { RetentionSection } from "./RetentionSection";
import { LoggingSection } from "../configEditor/LoggingSection";

//
// AccountConfigForm — the "smart" alternative to the raw JSON editor for the account service's `settings`
// config. Mirrors mediaConfig/MediaConfigForm.tsx: one section per AccountConfig.Config concern. Reads/
// writes the SAME JSON text the JSON editor shows.
//
// IMPORTANT: any new field added to AccountConfig.Config (packages/api/src/account/model/AccountConfig.ts)
// needs a matching control added here — see CLAUDE.md's "Models & closed sets" note.
//

/** The smart, form-based editor for the account service's `settings` AppConfig profile. */
export function AccountConfigForm( props : AccountConfigForm.Props )
{
    const config : AccountConfig.Config | null = AccountConfigFormModel.parse( props.content );

    if ( !config )
        return (
            <Box sx={{ p: 2 }}>
                <Typography variant="body2" sx={{ color: "error.main" }}>
                    Current content isn't valid JSON — switch to the JSON editor to fix it before using the smart editor.
                </Typography>
            </Box>
        );

    /** Commit an updated section back into the full config, re-serialize, and notify ConfigPanel. */
    function update<Key extends keyof AccountConfig.Config>( key : Key, value : AccountConfig.Config[ Key ] ) : void
    {
        const next : AccountConfig.Config = { ...( config as AccountConfig.Config ), [ key ]: value };
        props.onChange( AccountConfigFormModel.stringify( next ) );
    }

    return (
        <Box sx={{ p: 1.5, overflowY: "auto", height: "100%" }}>
            <HierarchySection value={config.hierarchy} readOnly={props.readOnly} onChange={( value : AccountConfig.Hierarchy ) : void => update( "hierarchy", value )} />
            <MembershipSection value={config.membership} readOnly={props.readOnly} onChange={( value : AccountConfig.Membership ) : void => update( "membership", value )} />
            <RetentionSection value={config.retention} readOnly={props.readOnly} onChange={( value : AccountConfig.Retention ) : void => update( "retention", value )} />
            <LoggingSection value={config.logLevel ?? LogLevel.INFO} readOnly={props.readOnly} onChange={( value : LogLevel ) : void => update( "logLevel", value )} />
        </Box>
    );
}

export namespace AccountConfigForm
{
    export interface Props
    {
        content  : string;
        onChange : ( content : string ) => void;
        readOnly : boolean;
    }
}

export default AccountConfigForm;
