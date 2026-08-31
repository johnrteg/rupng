import { VoiceConfig } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";

/** Per-account send caps — guards the default provider from a single account's runaway volume. */
export function LimitsSection( props : LimitsSection.Props )
{
    /** Patch one field of the limits config, preserving the rest. */
    function set( patch : Partial<VoiceConfig.Limits> ) : void
    {
        props.onChange( { ...props.value, ...patch } );
    }

    return (
        <ConfigSection title="Limits" hint="Default per-account call caps.">
            <RangeNumberField
                label="Max recipients / send" value={props.value.maxRecipientsPerSend} min={1} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { maxRecipientsPerSend: value } )}
            />
            <RangeNumberField
                label="Default rate (per minute)" help="Steady-state dial pace when a request doesn't specify its own." value={props.value.defaultRatePerMinute} min={1} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { defaultRatePerMinute: value } )}
            />
        </ConfigSection>
    );
}

export namespace LimitsSection
{
    export interface Props
    {
        value    : VoiceConfig.Limits;
        onChange : ( value : VoiceConfig.Limits ) => void;
        readOnly : boolean;
    }
}

export default LimitsSection;
