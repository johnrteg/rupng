import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import type { SelectChangeEvent } from "@mui/material/Select";
import { Email } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";

const UNSET : string = "";

/** Which system sender each notification case uses — a case with no entry falls back to the default sender. */
export function SystemSenderRoutingSection( props : SystemSenderRoutingSection.Props )
{
    /** Set (or clear, on "— default —") the sender for one notification case. */
    function onRouteChange( notificationType : Email.NotificationType, key : string ) : void
    {
        const next : Partial<Record<Email.NotificationType, string>> = { ...props.value };
        if ( key === UNSET ) delete next[ notificationType ];
        else next[ notificationType ] = key;
        props.onChange( next );
    }

    return (
        <ConfigSection title="Sender routing" hint="Override the default sender per notification case. Requires a sender key from System senders above.">
            {Object.values( Email.NotificationType ).map( ( notificationType : Email.NotificationType ) => (
                <Box key={notificationType} sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                    <Typography variant="body2">{notificationType}</Typography>
                    <Select
                        size="small" value={props.value[ notificationType ] ?? UNSET} disabled={props.readOnly}
                        onChange={( event : SelectChangeEvent ) : void => onRouteChange( notificationType, event.target.value )}
                        sx={{ minWidth: 150 }}
                    >
                        <MenuItem value={UNSET}>— default —</MenuItem>
                        {props.senderKeys.map( ( key : string ) => <MenuItem key={key} value={key}>{key}</MenuItem> )}
                    </Select>
                </Box>
            ) )}
        </ConfigSection>
    );
}

export namespace SystemSenderRoutingSection
{
    export interface Props
    {
        value     : Partial<Record<Email.NotificationType, string>>;
        senderKeys : Array<string>;
        onChange  : ( value : Partial<Record<Email.NotificationType, string>> ) => void;
        readOnly  : boolean;
    }
}

export default SystemSenderRoutingSection;
