import { MediaConfig } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";

/** Lifecycle & cost — when assets move to cold storage, how long a soft-deleted asset lingers before purge,
 *  and any default expiry. */
export function LifecycleSection( props : LifecycleSection.Props )
{
    /** Patch one field of the lifecycle config, preserving the rest. */
    function set( patch : Partial<MediaConfig.Lifecycle> ) : void
    {
        props.onChange( { ...props.value, ...patch } );
    }

    return (
        <ConfigSection title="Lifecycle" hint="Storage cost controls — cold-tier and purge timing.">
            <RangeNumberField
                label="Glacier after (days)" help="Days since last access before moving to cold tier."
                value={props.value.glacierAfterDays} min={0} disabled={props.readOnly}
                onChange={( days : number ) : void => set( { glacierAfterDays: days } )}
            />
            <RangeNumberField
                label="Soft-delete sweep (days)" help="Days a deleted asset lingers before its bytes are purged."
                value={props.value.softDeleteSweepDays} min={0} disabled={props.readOnly}
                onChange={( days : number ) : void => set( { softDeleteSweepDays: days } )}
            />
            <RangeNumberField
                label="Default TTL (days)" help="Auto-expiry for new assets. 0 = never expires."
                value={props.value.defaultTtlDays} min={0} disabled={props.readOnly}
                onChange={( days : number ) : void => set( { defaultTtlDays: days } )}
            />
        </ConfigSection>
    );
}

export namespace LifecycleSection
{
    export interface Props
    {
        value    : MediaConfig.Lifecycle;
        onChange : ( value : MediaConfig.Lifecycle ) => void;
        readOnly : boolean;
    }
}

export default LifecycleSection;
