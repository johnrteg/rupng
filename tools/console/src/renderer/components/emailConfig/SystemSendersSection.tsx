import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import type { SelectChangeEvent } from "@mui/material/Select";
import { Email, EmailConfig } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";

/** One named outbound sending identity — the platform's set of "from" addresses for different needs
 *  (no-reply, security alerts, …), referenced elsewhere by its stable `key`. */
function SenderRow( props : SenderRow.Props )
{
    /** Patch one field of this sender, preserving the rest. */
    function set( patch : Partial<Email.Sender> ) : void
    {
        props.onChange( { ...props.value, ...patch } );
    }

    return (
        <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, p: 1, display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            <TextField
                size="small" label="key" value={props.value.key} disabled={props.readOnly}
                onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => set( { key: event.target.value } )}
                sx={{ width: 110 }}
            />
            <TextField
                size="small" label="email" value={props.value.email} disabled={props.readOnly}
                onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => set( { email: event.target.value } )}
                sx={{ minWidth: 180 }}
            />
            <TextField
                size="small" label="name" value={props.value.name} disabled={props.readOnly}
                onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => set( { name: event.target.value } )}
                sx={{ minWidth: 140 }}
            />
            <TextField
                size="small" label="purpose" value={props.value.purpose ?? ""} disabled={props.readOnly}
                onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => set( { purpose: event.target.value } )}
                sx={{ flexGrow: 1, minWidth: 200 }}
            />
            <Tooltip title="Remove sender">
                <span><IconButton size="small" disabled={props.readOnly} onClick={props.onRemove}><DeleteIcon fontSize="small" /></IconButton></span>
            </Tooltip>
        </Box>
    );
}

namespace SenderRow
{
    export interface Props
    {
        value    : Email.Sender;
        onChange : ( value : Email.Sender ) => void;
        onRemove : () => void;
        readOnly : boolean;
    }
}

/** The platform's outbound sending identities (email-4.9), plus which one is the fallback default. */
export function SystemSendersSection( props : SystemSendersSection.Props )
{
    /** Patch one sender by array index. */
    function onSenderChange( index : number, value : Email.Sender ) : void
    {
        const next : Array<Email.Sender> = [ ...props.value.systemSenders ];
        next[ index ] = value;
        props.onChange( { ...props.value, systemSenders: next } );
    }

    /** Remove a sender by array index. A removed key that was the default falls back to the first remaining sender. */
    function onRemove( index : number ) : void
    {
        const next : Array<Email.Sender> = props.value.systemSenders.filter( ( _sender : Email.Sender, at : number ) : boolean => at !== index );
        const removedKey : string | undefined = props.value.systemSenders[ index ]?.key;
        const defaultKey : string = removedKey === props.value.defaultSystemSenderKey ? ( next[ 0 ]?.key ?? "" ) : props.value.defaultSystemSenderKey;
        props.onChange( { ...props.value, systemSenders: next, defaultSystemSenderKey: defaultKey } );
    }

    /** Add a new, uniquely-keyed sender with placeholder values. */
    function onAdd() : void
    {
        let index : number = props.value.systemSenders.length + 1;
        let key : string = `sender-${index}`;
        while ( props.value.systemSenders.some( ( sender : Email.Sender ) : boolean => sender.key === key ) ) { index += 1; key = `sender-${index}`; }
        props.onChange( { ...props.value, systemSenders: [ ...props.value.systemSenders, { key, email: "no-reply@platform.local", name: "Platform" } ] } );
    }

    return (
        <ConfigSection title="System senders" hint="The platform's outbound from-identities (verification, welcome, alerts, …).">
            {props.value.systemSenders.map( ( sender : Email.Sender, index : number ) => (
                <SenderRow
                    key={index} value={sender} readOnly={props.readOnly}
                    onChange={( value : Email.Sender ) : void => onSenderChange( index, value )}
                    onRemove={() : void => onRemove( index )}
                />
            ) )}
            <Button size="small" startIcon={<AddIcon />} disabled={props.readOnly} onClick={onAdd}>Add sender</Button>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Box>
                    <Typography variant="body2">Default sender</Typography>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>Used when a notification case has no routing entry below.</Typography>
                </Box>
                <Select
                    size="small" value={props.value.defaultSystemSenderKey} disabled={props.readOnly}
                    onChange={( event : SelectChangeEvent ) : void => props.onChange( { ...props.value, defaultSystemSenderKey: event.target.value } )}
                    sx={{ minWidth: 150 }}
                >
                    {props.value.systemSenders.map( ( sender : Email.Sender ) => <MenuItem key={sender.key} value={sender.key}>{sender.key}</MenuItem> )}
                </Select>
            </Box>
        </ConfigSection>
    );
}

export namespace SystemSendersSection
{
    export interface Props
    {
        value    : EmailConfig.Config;
        onChange : ( value : EmailConfig.Config ) => void;
        readOnly : boolean;
    }
}

export default SystemSendersSection;
