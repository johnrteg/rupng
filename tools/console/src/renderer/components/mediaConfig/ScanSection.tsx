import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import type { SelectChangeEvent } from "@mui/material/Select";
import { MediaConfig } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";

/** Malware-scan policy — which engine checks uploads, whether an unreachable engine fails closed, and the
 *  ClamAV connection (only shown/relevant when that engine is selected). */
export function ScanSection( props : ScanSection.Props )
{
    /** Patch one field of the scan config, preserving the rest. */
    function set( patch : Partial<MediaConfig.Scan> ) : void
    {
        props.onChange( { ...props.value, ...patch } );
    }

    /** Switch scan engine — picking a real engine turns scanning on; "none" turns it off. */
    function onProviderChange( event : SelectChangeEvent ) : void
    {
        const provider : MediaConfig.ScanProvider = event.target.value as MediaConfig.ScanProvider;
        set( { provider, enabled: provider !== MediaConfig.ScanProvider.NONE } );
    }

    const clamd : MediaConfig.ClamdConnection = props.value.clamd ?? { host: "localhost", port: 3310, timeoutMs: 30000 };

    return (
        <ConfigSection title="Malware scan" hint="Engine that checks uploads before they're servable.">
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Box>
                    <Typography variant="body2">Engine</Typography>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>
                        "none" disables scanning (dev only). "heuristic" is zero-infra magic-byte checks. "clamav" is a full signature engine.
                    </Typography>
                </Box>
                <Select size="small" value={props.value.provider} disabled={props.readOnly} onChange={onProviderChange} sx={{ minWidth: 150 }}>
                    {Object.values( MediaConfig.ScanProvider ).map( ( provider : MediaConfig.ScanProvider ) => <MenuItem key={provider} value={provider}>{provider}</MenuItem> )}
                </Select>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Box>
                    <Typography variant="body2">Fail closed</Typography>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>When the engine is unreachable, keep the file pending (redeliver) instead of auto-passing it.</Typography>
                </Box>
                <Switch
                    checked={props.value.failClosed} disabled={props.readOnly}
                    onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => set( { failClosed: event.target.checked } )}
                />
            </Box>
            {props.value.provider === MediaConfig.ScanProvider.CLAMAV && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25, pl: 1.5, borderLeft: "2px solid", borderColor: "divider" }}>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>ClamAV (clamd) connection</Typography>
                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                        <Typography variant="body2">Host</Typography>
                        <TextField
                            size="small" disabled={props.readOnly} value={clamd.host}
                            onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => set( { clamd: { ...clamd, host: event.target.value } } )}
                            sx={{ width: 160 }}
                        />
                    </Box>
                    <RangeNumberField
                        label="Port" value={clamd.port} min={1} max={65535} disabled={props.readOnly}
                        onChange={( port : number ) : void => set( { clamd: { ...clamd, port } } )}
                    />
                    <RangeNumberField
                        label="Timeout (ms)" value={clamd.timeoutMs ?? 30000} min={0} disabled={props.readOnly}
                        onChange={( timeoutMs : number ) : void => set( { clamd: { ...clamd, timeoutMs } } )}
                    />
                </Box>
            )}
        </ConfigSection>
    );
}

export namespace ScanSection
{
    export interface Props
    {
        value    : MediaConfig.Scan;
        onChange : ( value : MediaConfig.Scan ) => void;
        readOnly : boolean;
    }
}

export default ScanSection;
