import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Switch from "@mui/material/Switch";
import { MediaConfig } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";

/** Vision auto-tagging on process — off by default (needs an AI key configured via Secrets). */
export function AutoTagSection( props : AutoTagSection.Props )
{
    return (
        <ConfigSection title="Auto-tag" hint="Suggests tags for IMAGE assets via a vision model. Requires an AI key configured in Secrets.">
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Typography variant="body2">Enabled</Typography>
                <Switch
                    checked={props.value.enabled} disabled={props.readOnly}
                    onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => props.onChange( { ...props.value, enabled: event.target.checked } )}
                />
            </Box>
            <RangeNumberField
                label="Max tags" help="Upper bound on suggested tags per asset."
                value={props.value.maxTags} min={1} disabled={props.readOnly || !props.value.enabled}
                onChange={( maxTags : number ) : void => props.onChange( { ...props.value, maxTags } )}
            />
        </ConfigSection>
    );
}

export namespace AutoTagSection
{
    export interface Props
    {
        value    : MediaConfig.AutoTag;
        onChange : ( value : MediaConfig.AutoTag ) => void;
        readOnly : boolean;
    }
}

export default AutoTagSection;
