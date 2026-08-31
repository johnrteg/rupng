import { VoiceConfig } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";

/** The hour-of-day window calls may be placed in — a CURRENT SIMPLIFICATION (server UTC hour, not a
 *  per-destination timezone; see apps/core/voice/SPECS.md voice-4.1/4.7). A window may wrap midnight
 *  (start > end). */
export function QuietHoursSection( props : QuietHoursSection.Props )
{
    /** Patch one field of the quiet-hours window, preserving the rest. */
    function set( patch : Partial<VoiceConfig.QuietHours> ) : void
    {
        props.onChange( { ...props.value, ...patch } );
    }

    return (
        <ConfigSection title="Quiet hours" hint="Calls are gated outside this window. Simplification: server UTC hour, not per-destination local time (a documented gap).">
            <RangeNumberField
                label="Start hour" value={props.value.startHour} min={0} max={23} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { startHour: value } )}
            />
            <RangeNumberField
                label="End hour" value={props.value.endHour} min={0} max={23} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { endHour: value } )}
            />
        </ConfigSection>
    );
}

export namespace QuietHoursSection
{
    export interface Props
    {
        value    : VoiceConfig.QuietHours;
        onChange : ( value : VoiceConfig.QuietHours ) => void;
        readOnly : boolean;
    }
}

export default QuietHoursSection;
