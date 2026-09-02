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
import { Print, PrintConfig } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";

/** One configured mail-fulfillment provider entry — mirrors voiceConfig/ProviderRegistrySection.tsx's
 *  `ProviderRow`, trimmed to PrintConfig.ProviderEntry's shape. */
function ProviderRow( props : ProviderRow.Props )
{
    function set( patch : Partial<PrintConfig.ProviderEntry> ) : void { props.onChange( { ...props.value, ...patch } ); }

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
                    onChange={( event : SelectChangeEvent ) : void => set( { provider: event.target.value as Print.Provider } )}
                    sx={{ minWidth: 130 }}
                >
                    {Object.values( Print.Provider ).map( ( provider : Print.Provider ) => <MenuItem key={provider} value={provider}>{provider}</MenuItem> )}
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
                helperText="Secrets Manager entry name (e.g. print-postgrid) — never the key itself" sx={{ minWidth: 260 }}
            />
        </Box>
    );
}

namespace ProviderRow
{
    export interface Props
    {
        name     : string;
        value    : PrintConfig.ProviderEntry;
        onChange : ( value : PrintConfig.ProviderEntry ) => void;
        onRename : ( name : string ) => void;
        onRemove : () => void;
        readOnly : boolean;
    }
}

/** The configured mail-fulfillment provider registry — the factory only offers ENABLED entries as submit
 *  candidates. */
export function ProviderRegistrySection( props : ProviderRegistrySection.Props )
{
    function onRename( oldName : string, newName : string ) : void
    {
        if ( newName === oldName || newName.trim() === "" || props.value[ newName ] ) return;
        const next : Record<string, PrintConfig.ProviderEntry> = { ...props.value };
        next[ newName ] = next[ oldName ];
        delete next[ oldName ];
        props.onChange( next );
    }

    function onEntryChange( name : string, value : PrintConfig.ProviderEntry ) : void { props.onChange( { ...props.value, [ name ]: value } ); }

    function onRemove( name : string ) : void
    {
        const next : Record<string, PrintConfig.ProviderEntry> = { ...props.value };
        delete next[ name ];
        props.onChange( next );
    }

    function onAdd() : void
    {
        let index : number = Object.keys( props.value ).length + 1;
        let name : string = `provider-${index}`;
        while ( props.value[ name ] ) { index += 1; name = `provider-${index}`; }
        props.onChange( { ...props.value, [ name ]: { provider: Print.Provider.FAKE, enabled: false } } );
    }

    return (
        <ConfigSection title="Mail-fulfillment providers" hint="PostGrid / Lob. A credential only names a Secrets Manager entry — never an inline key.">
            {Object.entries( props.value ).map( ( [ name, entry ] : [ string, PrintConfig.ProviderEntry ] ) => (
                <ProviderRow
                    key={name} name={name} value={entry} readOnly={props.readOnly}
                    onRename={( newName : string ) : void => onRename( name, newName )}
                    onChange={( value : PrintConfig.ProviderEntry ) : void => onEntryChange( name, value )}
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
        value    : Record<string, PrintConfig.ProviderEntry>;
        onChange : ( value : Record<string, PrintConfig.ProviderEntry> ) => void;
        readOnly : boolean;
    }
}

export default ProviderRegistrySection;
