import { MediaConfig } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";

/** API throttle — the request-rate cap; storage quota is handled by account entitlements, not here. */
export function LimitsSection( props : LimitsSection.Props )
{
    return (
        <ConfigSection title="Limits" hint="Gateway-level API throttle for this service.">
            <RangeNumberField
                label="API rate (per minute)" help="Requests per minute before throttling kicks in."
                value={props.value.apiRatePerMinute} min={1} disabled={props.readOnly}
                onChange={( perMinute : number ) : void => props.onChange( { ...props.value, apiRatePerMinute: perMinute } )}
            />
        </ConfigSection>
    );
}

export namespace LimitsSection
{
    export interface Props
    {
        value    : MediaConfig.Limits;
        onChange : ( value : MediaConfig.Limits ) => void;
        readOnly : boolean;
    }
}

export default LimitsSection;
