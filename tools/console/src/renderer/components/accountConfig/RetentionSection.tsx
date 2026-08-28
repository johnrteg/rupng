import { AccountConfig } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";

/** Data-retention windows in days (account-12 / privacy) — how long audit/usage records and a soft-deleted
 *  account are kept, and the SLA to complete an erasure request. */
export function RetentionSection( props : RetentionSection.Props )
{
    /** Patch one field of the retention config, preserving the rest. */
    function set( patch : Partial<AccountConfig.Retention> ) : void
    {
        props.onChange( { ...props.value, ...patch } );
    }

    return (
        <ConfigSection title="Retention" hint="Data-retention windows, in days.">
            <RangeNumberField
                label="Audit events" value={props.value.auditDays} min={1} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { auditDays: value } )}
            />
            <RangeNumberField
                label="Deleted-account purge" help="How long a soft-deleted account is kept before purge." value={props.value.deletedAccountDays} min={1} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { deletedAccountDays: value } )}
            />
            <RangeNumberField
                label="Usage records" value={props.value.usageRecordDays} min={1} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { usageRecordDays: value } )}
            />
            <RangeNumberField
                label="Erasure SLA" help="Days to complete an erasure (GDPR forget) request." value={props.value.erasureSlaDays} min={1} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { erasureSlaDays: value } )}
            />
        </ConfigSection>
    );
}

export namespace RetentionSection
{
    export interface Props
    {
        value    : AccountConfig.Retention;
        onChange : ( value : AccountConfig.Retention ) => void;
        readOnly : boolean;
    }
}

export default RetentionSection;
