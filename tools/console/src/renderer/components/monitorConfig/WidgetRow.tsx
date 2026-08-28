import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import IconButton from "@mui/material/IconButton";
import DeleteIcon from "@mui/icons-material/Delete";
import type { SelectChangeEvent } from "@mui/material/Select";
import { MonitorConfig } from "@repo/api";

//
// WidgetRow — one MonitorConfig.WidgetConfig as an editable row: type, label, target, refresh
// interval, and optional warn/critical thresholds, plus a delete button. `target`'s placeholder
// hints at the expected physical identifier shape for the selected widget type.
//

/** The placeholder shown in the `target` field — the physical identifier shape for each widget type. */
function targetPlaceholder( type : MonitorConfig.WidgetType ) : string
{
    switch ( type )
    {
        case MonitorConfig.WidgetType.DYNAMO_TABLE: return "physical table name";
        case MonitorConfig.WidgetType.SQS_QUEUE:    return "queue URL";
        case MonitorConfig.WidgetType.ECS_SERVICE:  return "cluster/serviceName";
        case MonitorConfig.WidgetType.LAMBDA_JOB:   return "function name";
        case MonitorConfig.WidgetType.API_TARGET:   return "ALB target-group name";
        default:                                    return "";
    }
}

/** One editable widget row. */
export function WidgetRow( props : WidgetRow.Props )
{
    /** Patch one field of this widget, preserving the rest. */
    function set<Key extends keyof MonitorConfig.WidgetConfig>( key : Key, value : MonitorConfig.WidgetConfig[ Key ] ) : void
    {
        props.onChange( { ...props.value, [ key ]: value } );
    }

    /** Patch one threshold field, preserving the other. */
    function setThreshold( key : keyof MonitorConfig.Thresholds, raw : string ) : void
    {
        const value : number | undefined = raw.trim() === "" ? undefined : Number( raw );
        set( "thresholds", { ...props.value.thresholds, [ key ]: value } );
    }

    return (
        <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1, p: 1, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
            <Select
                size="small" value={props.value.type} disabled={props.readOnly} sx={{ minWidth: 150 }}
                onChange={( event : SelectChangeEvent ) : void => set( "type", event.target.value as MonitorConfig.WidgetType )}
            >
                {Object.values( MonitorConfig.WidgetType ).map( ( type : MonitorConfig.WidgetType ) => <MenuItem key={type} value={type}>{type}</MenuItem> )}
            </Select>
            <TextField
                size="small" label="Label" value={props.value.label} disabled={props.readOnly} sx={{ minWidth: 140 }}
                onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => set( "label", event.target.value )}
            />
            <TextField
                size="small" label="Target" placeholder={targetPlaceholder( props.value.type )} value={props.value.target} disabled={props.readOnly} sx={{ minWidth: 220, flexGrow: 1 }}
                onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => set( "target", event.target.value )}
            />
            <TextField
                size="small" type="number" label="Refresh (sec)" value={props.value.refreshIntervalSec} disabled={props.readOnly} sx={{ width: 120 }}
                slotProps={{ htmlInput: { min: 5 } }}
                onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => set( "refreshIntervalSec", Math.max( 5, Number( event.target.value ) || 5 ) )}
            />
            <TextField
                size="small" type="number" label="Warn ≥" value={props.value.thresholds?.warn ?? ""} disabled={props.readOnly} sx={{ width: 100 }}
                onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => setThreshold( "warn", event.target.value )}
            />
            <TextField
                size="small" type="number" label="Critical ≥" value={props.value.thresholds?.critical ?? ""} disabled={props.readOnly} sx={{ width: 100 }}
                onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => setThreshold( "critical", event.target.value )}
            />
            <IconButton size="small" aria-label="Remove widget" disabled={props.readOnly} onClick={props.onRemove}>
                <DeleteIcon fontSize="small" />
            </IconButton>
        </Box>
    );
}

export namespace WidgetRow
{
    export interface Props
    {
        value    : MonitorConfig.WidgetConfig;
        onChange : ( value : MonitorConfig.WidgetConfig ) => void;
        onRemove : () => void;
        readOnly : boolean;
    }
}

export default WidgetRow;
