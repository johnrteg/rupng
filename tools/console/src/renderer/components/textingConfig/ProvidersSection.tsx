import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import type { SelectChangeEvent } from "@mui/material/Select";
import { Texting, TextingConfig } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";

/** Which provider handles every send — texting has no per-account override yet (number routing, texting-4.x,
 *  isn't built), so this is the SINGLE send route until then. The provider itself is configured
 *  (secret/enabled) below in Provider registry. */
export function ProvidersSection( props : ProvidersSection.Props )
{
    return (
        <ConfigSection title="Providers" hint="The single send route for every message. Configure the provider's secret/enabled state below in Provider registry.">
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Box>
                    <Typography variant="body2">Default provider</Typography>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>Used for every send — texting has no per-account override yet.</Typography>
                </Box>
                <Select
                    size="small" value={props.value.defaultProvider} disabled={props.readOnly}
                    onChange={( event : SelectChangeEvent ) : void => props.onChange( { ...props.value, defaultProvider: event.target.value as Texting.Provider } )}
                    sx={{ minWidth: 150 }}
                >
                    {Object.values( Texting.Provider ).map( ( provider : Texting.Provider ) => <MenuItem key={provider} value={provider}>{provider}</MenuItem> )}
                </Select>
            </Box>
        </ConfigSection>
    );
}

export namespace ProvidersSection
{
    export interface Props
    {
        value    : TextingConfig.Config;
        onChange : ( value : TextingConfig.Config ) => void;
        readOnly : boolean;
    }
}

export default ProvidersSection;
