import TextField from "@mui/material/TextField";
import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";

/** Legacy TCR provisioning rules — the per-campaign line cap, the reuse grace period for released numbers,
 *  and the default area code offered when a request doesn't specify one. */
export function ProvisioningSection( props : ProvisioningSection.Props )
{
    return (
        <ConfigSection title="Provisioning" hint="Legacy TCR provisioning rules (registration-6.x). The line cap is exempt for the TRIAL use case (enforced in the impl).">
            <RangeNumberField
                label="Max lines / campaign" help="Legacy's hard cap (49)." value={props.maxLinesPerCampaign} min={1} disabled={props.readOnly}
                onChange={props.onChangeMaxLinesPerCampaign}
            />
            <RangeNumberField
                label="Reuse grace days" help="Released numbers stay reuse-eligible this long before full release." value={props.reuseGraceDays} min={0} disabled={props.readOnly}
                onChange={props.onChangeReuseGraceDays}
            />
            <TextField
                size="small" label="Default area code" value={props.defaultAreaCode ?? ""} disabled={props.readOnly} fullWidth
                onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => props.onChangeDefaultAreaCode( event.target.value || undefined )}
            />
        </ConfigSection>
    );
}

export namespace ProvisioningSection
{
    export interface Props
    {
        maxLinesPerCampaign          : number;
        reuseGraceDays               : number;
        defaultAreaCode?             : string;
        onChangeMaxLinesPerCampaign  : ( value : number ) => void;
        onChangeReuseGraceDays       : ( value : number ) => void;
        onChangeDefaultAreaCode      : ( value : string | undefined ) => void;
        readOnly                     : boolean;
    }
}

export default ProvisioningSection;
