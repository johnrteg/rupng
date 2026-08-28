import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import { EmailConfig } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";

/** Scheduled-send policy (email-6) — the safe lead-time buffer, how far out a send can be scheduled, and
 *  the timezone a `startAt` is interpreted against when the request omits one. */
export function SchedulingSection( props : SchedulingSection.Props )
{
    /** Patch one field of the scheduling config, preserving the rest. */
    function set( patch : Partial<EmailConfig.Scheduling> ) : void
    {
        props.onChange( { ...props.value, ...patch } );
    }

    return (
        <ConfigSection title="Scheduling" hint="Guardrails for a scheduled (not immediate) send.">
            <RangeNumberField
                label="Min lead (minutes)" help="A scheduled send's start time is clamped up to at least this far out." value={props.value.minLeadMinutes} min={0} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { minLeadMinutes: value } )}
            />
            <RangeNumberField
                label="Max lead (days)" help="How far out a send can be scheduled." value={props.value.maxLeadDays} min={1} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { maxLeadDays: value } )}
            />
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Box>
                    <Typography variant="body2">Default timezone</Typography>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>IANA zone (e.g. "UTC", "America/New_York") used when a request omits one.</Typography>
                </Box>
                <TextField
                    size="small" value={props.value.defaultTimezone} disabled={props.readOnly}
                    onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => set( { defaultTimezone: event.target.value } )}
                    sx={{ width: 180 }}
                />
            </Box>
        </ConfigSection>
    );
}

export namespace SchedulingSection
{
    export interface Props
    {
        value    : EmailConfig.Scheduling;
        onChange : ( value : EmailConfig.Scheduling ) => void;
        readOnly : boolean;
    }
}

export default SchedulingSection;
