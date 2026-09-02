import { PrintConfig } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";

/** Per-account submit caps — guards the default provider from a single account's runaway batch. */
export function LimitsSection( props : LimitsSection.Props )
{
    /** Patch one field of the limits config, preserving the rest. */
    function set( patch : Partial<PrintConfig.Limits> ) : void
    {
        props.onChange( { ...props.value, ...patch } );
    }

    return (
        <ConfigSection title="Limits" hint="Default per-account batch/rate caps.">
            <RangeNumberField
                label="Max recipients / batch" value={props.value.maxRecipientsPerBatch} min={1} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { maxRecipientsPerBatch: value } )}
            />
            <RangeNumberField
                label="Default rate (per minute)" help="Steady-state submit pace when a batch doesn't specify its own." value={props.value.defaultRatePerMinute} min={1} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { defaultRatePerMinute: value } )}
            />
        </ConfigSection>
    );
}

export namespace LimitsSection
{
    export interface Props
    {
        value    : PrintConfig.Limits;
        onChange : ( value : PrintConfig.Limits ) => void;
        readOnly : boolean;
    }
}

export default LimitsSection;
