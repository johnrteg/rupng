import { EmailConfig } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";

/** Per-account send caps — guards the default provider from a single account's runaway volume. A
 *  plan/entitlement may raise these for a specific account; these are just the platform defaults. */
export function LimitsSection( props : LimitsSection.Props )
{
    /** Patch one field of the limits config, preserving the rest. */
    function set( patch : Partial<EmailConfig.Limits> ) : void
    {
        props.onChange( { ...props.value, ...patch } );
    }

    return (
        <ConfigSection title="Limits" hint="Default per-account send caps.">
            <RangeNumberField
                label="Per account / day" value={props.value.perAccountPerDay} min={0} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { perAccountPerDay: value } )}
            />
            <RangeNumberField
                label="Per account / month" value={props.value.perAccountPerMonth} min={0} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { perAccountPerMonth: value } )}
            />
            <RangeNumberField
                label="Max recipients / send" value={props.value.maxRecipientsPerSend} min={1} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { maxRecipientsPerSend: value } )}
            />
            <RangeNumberField
                label="Default rate (per minute)" help="Steady-state throttle when a scheduled send doesn't specify its own." value={props.value.defaultRatePerMinute} min={1} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { defaultRatePerMinute: value } )}
            />
        </ConfigSection>
    );
}

export namespace LimitsSection
{
    export interface Props
    {
        value    : EmailConfig.Limits;
        onChange : ( value : EmailConfig.Limits ) => void;
        readOnly : boolean;
    }
}

export default LimitsSection;
