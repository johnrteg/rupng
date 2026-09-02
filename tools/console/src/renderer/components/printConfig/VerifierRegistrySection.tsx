import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Switch from "@mui/material/Switch";
import Chip from "@mui/material/Chip";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import type { SelectChangeEvent } from "@mui/material/Select";
import { Print, PrintConfig } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";

/** One configured address-verification source entry — a SEPARATE registry from the mail providers above
 *  (print-2.6). `capabilities` is a toggle per `Print.Capability` — NCOA requests route only to a source
 *  whose capabilities include it (checked here as informational metadata; the factory enforces it at runtime). */
function VerifierRow( props : VerifierRow.Props )
{
    function set( patch : Partial<PrintConfig.VerifierEntry> ) : void { props.onChange( { ...props.value, ...patch } ); }

    function toggleCapability( capability : Print.Capability ) : void
    {
        const has : boolean = props.value.capabilities.includes( capability );
        set( { capabilities: has ? props.value.capabilities.filter( ( item : Print.Capability ) : boolean => item !== capability ) : [ ...props.value.capabilities, capability ] } );
    }

    return (
        <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 1 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                <TextField
                    size="small" label="key" value={props.name} disabled={props.readOnly}
                    onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => props.onRename( event.target.value )}
                    sx={{ width: 150 }}
                />
                <Select
                    size="small" value={props.value.verifier} disabled={props.readOnly}
                    onChange={( event : SelectChangeEvent ) : void => set( { verifier: event.target.value as Print.AddressVerifierId } )}
                    sx={{ minWidth: 150 }}
                >
                    {Object.values( Print.AddressVerifierId ).map( ( verifier : Print.AddressVerifierId ) => <MenuItem key={verifier} value={verifier}>{verifier}</MenuItem> )}
                </Select>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>enabled</Typography>
                    <Switch checked={props.value.enabled} disabled={props.readOnly} onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => set( { enabled: event.target.checked } )} />
                </Box>
                <Tooltip title="Remove source">
                    <span><IconButton size="small" disabled={props.readOnly} onClick={props.onRemove}><DeleteIcon fontSize="small" /></IconButton></span>
                </Tooltip>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Typography variant="caption" sx={{ color: "text.disabled" }}>capabilities</Typography>
                {Object.values( Print.Capability ).map( ( capability : Print.Capability ) => (
                    <Chip
                        key={capability} size="small" label={capability}
                        color={props.value.capabilities.includes( capability ) ? "primary" : "default"}
                        variant={props.value.capabilities.includes( capability ) ? "filled" : "outlined"}
                        onClick={props.readOnly ? undefined : ( () : void => toggleCapability( capability ) )}
                    />
                ) )}
            </Box>
            <TextField
                size="small" label="secret ref" value={props.value.secretRef ?? ""} disabled={props.readOnly}
                onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => set( { secretRef: event.target.value || undefined } )}
                helperText="Secrets Manager entry name (e.g. print-melissa) — never the key itself" sx={{ minWidth: 260 }}
            />
        </Box>
    );
}

namespace VerifierRow
{
    export interface Props
    {
        name     : string;
        value    : PrintConfig.VerifierEntry;
        onChange : ( value : PrintConfig.VerifierEntry ) => void;
        onRename : ( name : string ) => void;
        onRemove : () => void;
        readOnly : boolean;
    }
}

/** The configured address-verification source registry (print-2.6) — independent of the mail-fulfillment
 *  providers above; verify with one, mail with another. */
export function VerifierRegistrySection( props : VerifierRegistrySection.Props )
{
    function onRename( oldName : string, newName : string ) : void
    {
        if ( newName === oldName || newName.trim() === "" || props.value[ newName ] ) return;
        const next : Record<string, PrintConfig.VerifierEntry> = { ...props.value };
        next[ newName ] = next[ oldName ];
        delete next[ oldName ];
        props.onChange( next );
    }

    function onEntryChange( name : string, value : PrintConfig.VerifierEntry ) : void { props.onChange( { ...props.value, [ name ]: value } ); }

    function onRemove( name : string ) : void
    {
        const next : Record<string, PrintConfig.VerifierEntry> = { ...props.value };
        delete next[ name ];
        props.onChange( next );
    }

    function onAdd() : void
    {
        let index : number = Object.keys( props.value ).length + 1;
        let name : string = `verifier-${index}`;
        while ( props.value[ name ] ) { index += 1; name = `verifier-${index}`; }
        props.onChange( { ...props.value, [ name ]: { verifier: Print.AddressVerifierId.FAKE, enabled: false, capabilities: [] } } );
    }

    return (
        <ConfigSection title="Address-verification sources" hint="USPS Web Tools / PostGrid / Lob / Melissa / SmartyStreets — a SEPARATE factory from mail fulfillment (verify with one, mail with another). NCOA routes only to a source whose capabilities include it.">
            {Object.entries( props.value ).map( ( [ name, entry ] : [ string, PrintConfig.VerifierEntry ] ) => (
                <VerifierRow
                    key={name} name={name} value={entry} readOnly={props.readOnly}
                    onRename={( newName : string ) : void => onRename( name, newName )}
                    onChange={( value : PrintConfig.VerifierEntry ) : void => onEntryChange( name, value )}
                    onRemove={() : void => onRemove( name )}
                />
            ) )}
            <Button size="small" startIcon={<AddIcon />} disabled={props.readOnly} onClick={onAdd}>Add source</Button>
        </ConfigSection>
    );
}

export namespace VerifierRegistrySection
{
    export interface Props
    {
        value    : Record<string, PrintConfig.VerifierEntry>;
        onChange : ( value : Record<string, PrintConfig.VerifierEntry> ) => void;
        readOnly : boolean;
    }
}

export default VerifierRegistrySection;
