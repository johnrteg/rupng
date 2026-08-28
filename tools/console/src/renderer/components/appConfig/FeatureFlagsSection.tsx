import Box from "@mui/material/Box";
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
import { GetBootstrap } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";

/** A flag's value TYPE — drives which input renders. Boolean = on/off; string = an A/B variant label;
 *  number = a staged percentage / numeric gate. */
type FlagType = "boolean" | "string" | "number";

/** Which type a flag's current value is. */
function typeOf( value : GetBootstrap.FlagValue ) : FlagType
{
    if ( typeof value === "boolean" ) return "boolean";
    if ( typeof value === "number" ) return "number";
    return "string";
}

/** The zero-value used when switching a flag's type (so the input starts in a sane state). */
function zeroFor( type : FlagType ) : GetBootstrap.FlagValue
{
    if ( type === "boolean" ) return false;
    if ( type === "number" ) return 0;
    return "";
}

/** One feature-flag row — a key, its value TYPE (boolean/string/number), and the matching input. */
function FlagRow( props : FlagRow.Props )
{
    const type : FlagType = typeOf( props.value );

    return (
        <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, p: 1, display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            <TextField
                size="small" label="key" value={props.name} disabled={props.readOnly}
                onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => props.onRename( event.target.value )}
                sx={{ width: 160 }}
            />
            <Select
                size="small" value={type} disabled={props.readOnly}
                onChange={( event : SelectChangeEvent ) : void => props.onChange( zeroFor( event.target.value as FlagType ) )}
                sx={{ minWidth: 110 }}
            >
                <MenuItem value="boolean">boolean</MenuItem>
                <MenuItem value="string">string</MenuItem>
                <MenuItem value="number">number</MenuItem>
            </Select>
            {type === "boolean" && (
                <Switch checked={props.value === true} disabled={props.readOnly} onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => props.onChange( event.target.checked )} />
            )}
            {type === "string" && (
                <TextField
                    size="small" label="variant" value={String( props.value )} disabled={props.readOnly}
                    onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => props.onChange( event.target.value )}
                    sx={{ minWidth: 160 }}
                />
            )}
            {type === "number" && (
                <RangeNumberField label="value" value={Number( props.value )} disabled={props.readOnly} onChange={( value : number ) : void => props.onChange( value )} />
            )}
            <Tooltip title="Remove flag">
                <span><IconButton size="small" disabled={props.readOnly} onClick={props.onRemove}><DeleteIcon fontSize="small" /></IconButton></span>
            </Tooltip>
        </Box>
    );
}

namespace FlagRow
{
    export interface Props
    {
        name     : string;
        value    : GetBootstrap.FlagValue;
        onChange : ( value : GetBootstrap.FlagValue ) => void;
        onRename : ( name : string ) => void;
        onRemove : () => void;
        readOnly : boolean;
    }
}

/** The effective platform feature-flag set (app-2) — a simple on/off, an A/B variant label, or a staged
 *  numeric gate per flag key. An account-level override (not edited here) wins over this platform default. */
export function FeatureFlagsSection( props : FeatureFlagsSection.Props )
{
    /** Rename a flag's key — a no-op if the new name is blank or already taken. */
    function onRename( oldName : string, newName : string ) : void
    {
        if ( newName === oldName || newName.trim() === "" || Object.prototype.hasOwnProperty.call( props.value, newName ) ) return;
        const next : GetBootstrap.FeatureFlags = { ...props.value };
        next[ newName ] = next[ oldName ];
        delete next[ oldName ];
        props.onChange( next );
    }

    /** Patch one flag's value by key. */
    function onFlagChange( name : string, value : GetBootstrap.FlagValue ) : void
    {
        props.onChange( { ...props.value, [ name ]: value } );
    }

    /** Remove a flag by key. */
    function onRemove( name : string ) : void
    {
        const next : GetBootstrap.FeatureFlags = { ...props.value };
        delete next[ name ];
        props.onChange( next );
    }

    /** Add a new, uniquely-keyed boolean flag (off by default). */
    function onAdd() : void
    {
        let index : number = Object.keys( props.value ).length + 1;
        let name : string = `flag-${index}`;
        while ( Object.prototype.hasOwnProperty.call( props.value, name ) ) { index += 1; name = `flag-${index}`; }
        props.onChange( { ...props.value, [ name ]: false } );
    }

    return (
        <ConfigSection title="Feature flags" hint="Platform defaults — an account-level override (not shown here) always wins.">
            {Object.entries( props.value ).map( ( [ name, value ] : [ string, GetBootstrap.FlagValue ] ) => (
                <FlagRow
                    key={name} name={name} value={value} readOnly={props.readOnly}
                    onRename={( newName : string ) : void => onRename( name, newName )}
                    onChange={( value : GetBootstrap.FlagValue ) : void => onFlagChange( name, value )}
                    onRemove={() : void => onRemove( name )}
                />
            ) )}
            <Button size="small" startIcon={<AddIcon />} disabled={props.readOnly} onClick={onAdd}>Add flag</Button>
        </ConfigSection>
    );
}

export namespace FeatureFlagsSection
{
    export interface Props
    {
        value    : GetBootstrap.FeatureFlags;
        onChange : ( value : GetBootstrap.FeatureFlags ) => void;
        readOnly : boolean;
    }
}

export default FeatureFlagsSection;
