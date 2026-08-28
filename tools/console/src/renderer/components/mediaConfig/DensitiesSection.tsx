import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Switch from "@mui/material/Switch";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import { MediaConfig } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";

/** One named DPI/density target row — label, target DPI, and whether the source is upscaled to reach it. */
function DensityRow( props : DensityRow.Props )
{
    /** Patch one field of this density target, preserving the rest. */
    function set( patch : Partial<MediaConfig.DensityTarget> ) : void
    {
        props.onChange( { ...props.value, ...patch } );
    }

    return (
        <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, p: 1, display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            <TextField
                size="small" label="key" value={props.name} disabled={props.readOnly}
                onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => props.onRename( event.target.value )}
                sx={{ width: 110 }}
            />
            <TextField
                size="small" label="label" value={props.value.label} disabled={props.readOnly}
                onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => set( { label: event.target.value } )}
                sx={{ flexGrow: 1, minWidth: 140 }}
            />
            <RangeNumberField label="DPI" value={props.value.dpi} min={1} disabled={props.readOnly} onChange={( dpi : number ) : void => set( { dpi } )} />
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <Typography variant="caption" sx={{ color: "text.disabled" }}>upscale</Typography>
                <Switch
                    checked={props.value.upscale ?? true} disabled={props.readOnly}
                    onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => set( { upscale: event.target.checked } )}
                />
            </Box>
            <Tooltip title="Remove density">
                <span><IconButton size="small" disabled={props.readOnly} onClick={props.onRemove}><DeleteIcon fontSize="small" /></IconButton></span>
            </Tooltip>
        </Box>
    );
}

namespace DensityRow
{
    export interface Props
    {
        name     : string;
        value    : MediaConfig.DensityTarget;
        onChange : ( value : MediaConfig.DensityTarget ) => void;
        onRename : ( name : string ) => void;
        onRemove : () => void;
        readOnly : boolean;
    }
}

/** Named DPI targets for image density variants (media-4) — e.g. "web" (72dpi) / "print" (300dpi). */
export function DensitiesSection( props : DensitiesSection.Props )
{
    /** Rename a target's key — a no-op if the new name is blank or already taken. */
    function onRename( oldName : string, newName : string ) : void
    {
        if ( newName === oldName || newName.trim() === "" || props.value[ newName ] ) return;
        const next : Record<string, MediaConfig.DensityTarget> = { ...props.value };
        next[ newName ] = next[ oldName ];
        delete next[ oldName ];
        props.onChange( next );
    }

    /** Patch one density target by key. */
    function onTargetChange( name : string, value : MediaConfig.DensityTarget ) : void
    {
        props.onChange( { ...props.value, [ name ]: value } );
    }

    /** Remove a density target by key. */
    function onRemove( name : string ) : void
    {
        const next : Record<string, MediaConfig.DensityTarget> = { ...props.value };
        delete next[ name ];
        props.onChange( next );
    }

    /** Add a new, uniquely-keyed density target with sane starting defaults. */
    function onAdd() : void
    {
        let index : number = Object.keys( props.value ).length + 1;
        let name : string = `density-${index}`;
        while ( props.value[ name ] ) { index += 1; name = `density-${index}`; }
        props.onChange( { ...props.value, [ name ]: { label: "New density", dpi: 96, upscale: false } } );
    }

    return (
        <ConfigSection title="Densities" hint="Named DPI targets for image density variants.">
            {Object.entries( props.value ).map( ( [ name, target ] : [ string, MediaConfig.DensityTarget ] ) => (
                <DensityRow
                    key={name} name={name} value={target} readOnly={props.readOnly}
                    onRename={( newName : string ) : void => onRename( name, newName )}
                    onChange={( value : MediaConfig.DensityTarget ) : void => onTargetChange( name, value )}
                    onRemove={() : void => onRemove( name )}
                />
            ) )}
            <Button size="small" startIcon={<AddIcon />} disabled={props.readOnly} onClick={onAdd}>Add density</Button>
        </ConfigSection>
    );
}

export namespace DensitiesSection
{
    export interface Props
    {
        value    : Record<string, MediaConfig.DensityTarget>;
        onChange : ( value : Record<string, MediaConfig.DensityTarget> ) => void;
        readOnly : boolean;
    }
}

export default DensitiesSection;
