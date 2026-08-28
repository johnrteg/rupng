import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import type { SelectChangeEvent } from "@mui/material/Select";
import { LogLevel } from "@repo/api";
import { ConfigSection } from "./ConfigSection";

/** Log verbosity — applied LIVE (no redeploy): the running service polls this same `config/settings`
 *  profile (`Application.refreshLogLevel`) and raises/lowers its logger's minimum level within ~30s. */
export function LoggingSection( props : LoggingSection.Props )
{
    /** Switch the minimum log level. */
    function onLevelChange( event : SelectChangeEvent ) : void
    {
        props.onChange( event.target.value as LogLevel );
    }

    return (
        <ConfigSection title="Logging" hint="Minimum level this service emits. Applies live within ~30s — no redeploy or restart needed.">
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Box>
                    <Typography variant="body2">Level</Typography>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>
                        trace = routine activity (verbose). info = normal operation. warn/error = problems only.
                    </Typography>
                </Box>
                <Select size="small" value={props.value} disabled={props.readOnly} onChange={onLevelChange} sx={{ minWidth: 150 }}>
                    {Object.values( LogLevel ).map( ( level : LogLevel ) => <MenuItem key={level} value={level}>{level}</MenuItem> )}
                </Select>
            </Box>
        </ConfigSection>
    );
}

export namespace LoggingSection
{
    export interface Props
    {
        value    : LogLevel;
        onChange : ( value : LogLevel ) => void;
        readOnly : boolean;
    }
}

export default LoggingSection;
