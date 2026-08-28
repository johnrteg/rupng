import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import type { SelectChangeEvent } from "@mui/material/Select";
import { MediaConfig } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";

/** Variant generation policy — pre-generate all renditions vs. derive on first request. Per-profile variant
 *  specs (`profiles`) stay in the JSON editor — their nested media/format detail isn't worth a bespoke form. */
export function VariantsSection( props : VariantsSection.Props )
{
    const profileNames : Array<string> = Object.keys( props.value.profiles );

    /** Switch the pre-generation strategy. */
    function onStrategyChange( event : SelectChangeEvent ) : void
    {
        props.onChange( { ...props.value, strategy: event.target.value as MediaConfig.Variants[ "strategy" ] } );
    }

    return (
        <ConfigSection title="Variants" hint="How display renditions are generated. Edit individual variant profiles via the JSON editor.">
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Box>
                    <Typography variant="body2">Strategy</Typography>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>Preprocess = generate all variants up front. On-demand = derive at the edge on first request.</Typography>
                </Box>
                <Select size="small" value={props.value.strategy} disabled={props.readOnly} onChange={onStrategyChange} sx={{ minWidth: 150 }}>
                    <MenuItem value="preprocess">preprocess</MenuItem>
                    <MenuItem value="ondemand">ondemand</MenuItem>
                </Select>
            </Box>
            <Typography variant="caption" sx={{ color: "text.disabled" }}>
                {profileNames.length} profile{profileNames.length === 1 ? "" : "s"}: {profileNames.join( ", " ) || "(none)"}
            </Typography>
        </ConfigSection>
    );
}

export namespace VariantsSection
{
    export interface Props
    {
        value    : MediaConfig.Variants;
        onChange : ( value : MediaConfig.Variants ) => void;
        readOnly : boolean;
    }
}

export default VariantsSection;
