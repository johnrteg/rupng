import { RegistrationConfig } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";

/** Poll-sweep backoff cadence (registration-5.3) — in-flight registrations only, back off between sweeps,
 *  stop entirely once a registration reaches a terminal status. */
export function PollSweepSection( props : PollSweepSection.Props )
{
    /** Patch one field of the poll-sweep cadence, preserving the rest. */
    function set( patch : Partial<RegistrationConfig.PollSweep> ) : void
    {
        props.onChange( { ...props.value, ...patch } );
    }

    return (
        <ConfigSection title="Poll sweep" hint="Backoff cadence for in-flight TCR status polling. Stops entirely once a registration reaches a terminal status.">
            <RangeNumberField
                label="Initial delay (seconds)" value={props.value.initialDelaySeconds} min={1} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { initialDelaySeconds: value } )}
            />
            <RangeNumberField
                label="Max delay (seconds)" value={props.value.maxDelaySeconds} min={1} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { maxDelaySeconds: value } )}
            />
            <RangeNumberField
                label="Backoff multiplier" value={props.value.backoffMultiplier} min={1} step={0.1} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { backoffMultiplier: value } )}
            />
        </ConfigSection>
    );
}

export namespace PollSweepSection
{
    export interface Props
    {
        value    : RegistrationConfig.PollSweep;
        onChange : ( value : RegistrationConfig.PollSweep ) => void;
        readOnly : boolean;
    }
}

export default PollSweepSection;
