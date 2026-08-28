import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import { ConfigSection } from "../configEditor/ConfigSection";

/** Platform identity shown in the public bootstrap blob — the site/app name and its display name. */
export function BrandingSection( props : BrandingSection.Props )
{
    return (
        <ConfigSection title="Branding" hint="Public — served to every browser via the login bootstrap.">
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Typography variant="body2">App name</Typography>
                <TextField
                    size="small" value={props.name} disabled={props.readOnly}
                    onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => props.onChange( event.target.value, props.displayName )}
                    sx={{ width: 200 }}
                />
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Typography variant="body2">Display name</Typography>
                <TextField
                    size="small" value={props.displayName} disabled={props.readOnly}
                    onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => props.onChange( props.name, event.target.value )}
                    sx={{ width: 200 }}
                />
            </Box>
        </ConfigSection>
    );
}

export namespace BrandingSection
{
    export interface Props
    {
        name        : string;
        displayName : string;
        onChange    : ( name : string, displayName : string ) => void;
        readOnly    : boolean;
    }
}

export default BrandingSection;
