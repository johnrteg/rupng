import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import type { SelectChangeEvent } from "@mui/material/Select";
import { MediaConfig } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";

/** One named video-compression target row — label/codec plus the optional dimension/size/duration/framerate/
 *  audio caps. A 0 in an optional numeric field means "unset" (no cap). */
function VideoTargetRow( props : VideoTargetRow.Props )
{
    /** Patch one field of this target, preserving the rest. */
    function set( patch : Partial<MediaConfig.VideoTarget> ) : void
    {
        props.onChange( { ...props.value, ...patch } );
    }

    return (
        <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 1 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
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
                <Select
                    size="small" value={props.value.codec} disabled={props.readOnly}
                    onChange={( event : SelectChangeEvent ) : void => set( { codec: event.target.value as MediaConfig.VideoCodec } )}
                    sx={{ minWidth: 100 }}
                >
                    {Object.values( MediaConfig.VideoCodec ).map( ( codec : MediaConfig.VideoCodec ) => <MenuItem key={codec} value={codec}>{codec}</MenuItem> )}
                </Select>
                <Tooltip title="Remove target">
                    <span><IconButton size="small" disabled={props.readOnly} onClick={props.onRemove}><DeleteIcon fontSize="small" /></IconButton></span>
                </Tooltip>
            </Box>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
                <RangeNumberField label="Max width" help="0 = no cap." value={props.value.maxWidth ?? 0} min={0} disabled={props.readOnly}
                    onChange={( maxWidth : number ) : void => set( { maxWidth: maxWidth || undefined } )} />
                <RangeNumberField label="Max size (KB)" help="0 = no cap." value={props.value.maxSizeKb ?? 0} min={0} disabled={props.readOnly}
                    onChange={( maxSizeKb : number ) : void => set( { maxSizeKb: maxSizeKb || undefined } )} />
                <RangeNumberField label="Max seconds" help="0 = no cap." value={props.value.maxSeconds ?? 0} min={0} disabled={props.readOnly}
                    onChange={( maxSeconds : number ) : void => set( { maxSeconds: maxSeconds || undefined } )} />
                <RangeNumberField label="FPS cap" help="0 = no cap." value={props.value.fpsCap ?? 0} min={0} disabled={props.readOnly}
                    onChange={( fpsCap : number ) : void => set( { fpsCap: fpsCap || undefined } )} />
                <RangeNumberField label="Audio (kbps)" help="0 = no cap." value={props.value.audioKbps ?? 0} min={0} disabled={props.readOnly}
                    onChange={( audioKbps : number ) : void => set( { audioKbps: audioKbps || undefined } )} />
            </Box>
        </Box>
    );
}

namespace VideoTargetRow
{
    export interface Props
    {
        name     : string;
        value    : MediaConfig.VideoTarget;
        onChange : ( value : MediaConfig.VideoTarget ) => void;
        onRename : ( name : string ) => void;
        onRemove : () => void;
        readOnly : boolean;
    }
}

/** Named video-compression targets (media-10.10) — the distribution presets a compress job encodes to. */
export function VideoTargetsSection( props : VideoTargetsSection.Props )
{
    /** Rename a target's key — a no-op if the new name is blank or already taken. */
    function onRename( oldName : string, newName : string ) : void
    {
        if ( newName === oldName || newName.trim() === "" || props.value[ newName ] ) return;
        const next : Record<string, MediaConfig.VideoTarget> = { ...props.value };
        next[ newName ] = next[ oldName ];
        delete next[ oldName ];
        props.onChange( next );
    }

    /** Patch one target by key. */
    function onTargetChange( name : string, value : MediaConfig.VideoTarget ) : void
    {
        props.onChange( { ...props.value, [ name ]: value } );
    }

    /** Remove a target by key. */
    function onRemove( name : string ) : void
    {
        const next : Record<string, MediaConfig.VideoTarget> = { ...props.value };
        delete next[ name ];
        props.onChange( next );
    }

    /** Add a new, uniquely-keyed target with sane starting defaults. */
    function onAdd() : void
    {
        let index : number = Object.keys( props.value ).length + 1;
        let name : string = `target-${index}`;
        while ( props.value[ name ] ) { index += 1; name = `target-${index}`; }
        props.onChange( { ...props.value, [ name ]: { label: "New target", codec: MediaConfig.VideoCodec.H264 } } );
    }

    return (
        <ConfigSection title="Video compression targets" hint="Named distribution presets a compress job encodes video to.">
            {Object.entries( props.value ).map( ( [ name, target ] : [ string, MediaConfig.VideoTarget ] ) => (
                <VideoTargetRow
                    key={name} name={name} value={target} readOnly={props.readOnly}
                    onRename={( newName : string ) : void => onRename( name, newName )}
                    onChange={( value : MediaConfig.VideoTarget ) : void => onTargetChange( name, value )}
                    onRemove={() : void => onRemove( name )}
                />
            ) )}
            <Button size="small" startIcon={<AddIcon />} disabled={props.readOnly} onClick={onAdd}>Add target</Button>
        </ConfigSection>
    );
}

export namespace VideoTargetsSection
{
    export interface Props
    {
        value    : Record<string, MediaConfig.VideoTarget>;
        onChange : ( value : Record<string, MediaConfig.VideoTarget> ) => void;
        readOnly : boolean;
    }
}

export default VideoTargetsSection;
