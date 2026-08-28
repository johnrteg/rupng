import { SocialConfig } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";

/** Default review-workflow policy — how many distinct approvals a post needs before it can publish,
 *  unless overridden per account. A post snapshots this at submit time (SPECS.md §8). */
export function ApprovalsSection( props : ApprovalsSection.Props )
{
    return (
        <ConfigSection title="Approvals" hint="Default approvals-required count for new posts. 0 = no review workflow.">
            <RangeNumberField
                label="Required approvals" value={props.value.requiredDefault} min={0} max={5} disabled={props.readOnly}
                onChange={( value : number ) : void => props.onChange( { ...props.value, requiredDefault: value } )}
            />
        </ConfigSection>
    );
}

export namespace ApprovalsSection
{
    export interface Props
    {
        value    : SocialConfig.Approvals;
        onChange : ( value : SocialConfig.Approvals ) => void;
        readOnly : boolean;
    }
}

export default ApprovalsSection;
