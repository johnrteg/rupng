import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import type { SelectChangeEvent } from "@mui/material/Select";
import { Media, MediaConfig } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";

/** Delivery hand-off — signed URL lifetime and the default tier when an uploader doesn't specify one. */
export function DeliverySection( props : DeliverySection.Props )
{
    /** Switch the default delivery tier. */
    function onTierChange( event : SelectChangeEvent ) : void
    {
        props.onChange( { ...props.value, defaultTier: event.target.value as Media.Tier } );
    }

    return (
        <ConfigSection title="Delivery" hint="How served bytes are handed off to clients.">
            <RangeNumberField
                label="Signed URL TTL (sec)" help="GET (preview/download) URL lifetime. 900 = 15 minutes."
                value={props.value.signedUrlTtlSec} min={1} disabled={props.readOnly}
                onChange={( seconds : number ) : void => props.onChange( { ...props.value, signedUrlTtlSec: seconds } )}
            />
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Box>
                    <Typography variant="body2">Default tier</Typography>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>Used when the uploader doesn't specify a delivery tier.</Typography>
                </Box>
                <Select size="small" value={props.value.defaultTier} disabled={props.readOnly} onChange={onTierChange} sx={{ minWidth: 150 }}>
                    {Object.values( Media.Tier ).map( ( tier : Media.Tier ) => <MenuItem key={tier} value={tier}>{tier}</MenuItem> )}
                </Select>
            </Box>
        </ConfigSection>
    );
}

export namespace DeliverySection
{
    export interface Props
    {
        value    : MediaConfig.Delivery;
        onChange : ( value : MediaConfig.Delivery ) => void;
        readOnly : boolean;
    }
}

export default DeliverySection;
