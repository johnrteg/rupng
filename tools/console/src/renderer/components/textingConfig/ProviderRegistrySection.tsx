import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Switch from "@mui/material/Switch";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import type { SelectChangeEvent } from "@mui/material/Select";
import { Texting, TextingConfig } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";

/** One configured provider entry — which CPaaS, whether it's enabled, and which Secrets Manager entry
 *  holds its credential. The credential itself (`secretRef`) only NAMES a secret — never an inline key. */
function ProviderRow( props : ProviderRow.Props )
{
    /** Patch one field of this provider entry, preserving the rest. */
    function set( patch : Partial<TextingConfig.ProviderEntry> ) : void
    {
        props.onChange( { ...props.value, ...patch } );
    }

    return (
        <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 1 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                <TextField
                    size="small" label="key" value={props.name} disabled={props.readOnly}
                    onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => props.onRename( event.target.value )}
                    sx={{ width: 130 }}
                />
                <Select
                    size="small" value={props.value.provider} disabled={props.readOnly}
                    onChange={( event : SelectChangeEvent ) : void => set( { provider: event.target.value as Texting.Provider } )}
                    sx={{ minWidth: 150 }}
                >
                    {Object.values( Texting.Provider ).map( ( provider : Texting.Provider ) => <MenuItem key={provider} value={provider}>{provider}</MenuItem> )}
                </Select>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>enabled</Typography>
                    <Switch checked={props.value.enabled} disabled={props.readOnly} onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => set( { enabled: event.target.checked } )} />
                </Box>
                <Tooltip title="Remove provider">
                    <span><IconButton size="small" disabled={props.readOnly} onClick={props.onRemove}><DeleteIcon fontSize="small" /></IconButton></span>
                </Tooltip>
            </Box>
            <TextField
                size="small" label="secret ref" value={props.value.secretRef ?? ""} disabled={props.readOnly}
                onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => set( { secretRef: event.target.value || undefined } )}
                helperText="Secrets Manager entry name (e.g. texting-twilio) — never the key itself" sx={{ minWidth: 260 }}
            />
        </Box>
    );
}

namespace ProviderRow
{
    export interface Props
    {
        name     : string;
        value    : TextingConfig.ProviderEntry;
        onChange : ( value : TextingConfig.ProviderEntry ) => void;
        onRename : ( name : string ) => void;
        onRemove : () => void;
        readOnly : boolean;
    }
}

/** The configured provider registry — the factory only offers ENABLED entries here as send candidates. */
export function ProviderRegistrySection( props : ProviderRegistrySection.Props )
{
    /** Rename an entry's key — a no-op if the new name is blank or already taken. */
    function onRename( oldName : string, newName : string ) : void
    {
        if ( newName === oldName || newName.trim() === "" || props.value[ newName ] ) return;
        const next : Record<string, TextingConfig.ProviderEntry> = { ...props.value };
        next[ newName ] = next[ oldName ];
        delete next[ oldName ];
        props.onChange( next );
    }

    /** Patch one provider entry by key. */
    function onEntryChange( name : string, value : TextingConfig.ProviderEntry ) : void
    {
        props.onChange( { ...props.value, [ name ]: value } );
    }

    /** Remove a provider entry by key. */
    function onRemove( name : string ) : void
    {
        const next : Record<string, TextingConfig.ProviderEntry> = { ...props.value };
        delete next[ name ];
        props.onChange( next );
    }

    /** Add a new, uniquely-keyed provider entry, disabled by default until its secret is wired up. */
    function onAdd() : void
    {
        let index : number = Object.keys( props.value ).length + 1;
        let name : string = `provider-${index}`;
        while ( props.value[ name ] ) { index += 1; name = `provider-${index}`; }
        props.onChange( { ...props.value, [ name ]: { provider: Texting.Provider.FAKE, enabled: false } } );
    }

    return (
        <ConfigSection title="Provider registry" hint="Configured CPaaS vendors. A credential only names a Secrets Manager entry — never an inline key.">
            {Object.entries( props.value ).map( ( [ name, entry ] : [ string, TextingConfig.ProviderEntry ] ) => (
                <ProviderRow
                    key={name} name={name} value={entry} readOnly={props.readOnly}
                    onRename={( newName : string ) : void => onRename( name, newName )}
                    onChange={( value : TextingConfig.ProviderEntry ) : void => onEntryChange( name, value )}
                    onRemove={() : void => onRemove( name )}
                />
            ) )}
            <Button size="small" startIcon={<AddIcon />} disabled={props.readOnly} onClick={onAdd}>Add provider</Button>
        </ConfigSection>
    );
}

export namespace ProviderRegistrySection
{
    export interface Props
    {
        value    : Record<string, TextingConfig.ProviderEntry>;
        onChange : ( value : Record<string, TextingConfig.ProviderEntry> ) => void;
        readOnly : boolean;
    }
}

export default ProviderRegistrySection;
