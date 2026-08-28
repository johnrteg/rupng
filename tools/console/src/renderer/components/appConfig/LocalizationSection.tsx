import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import type { SelectChangeEvent } from "@mui/material/Select";
import { ConfigSection } from "../configEditor/ConfigSection";

/** The offered country list and the default country code — the default's picker always includes the
 *  current value even if it fell out of the list, so a stale/edited config never shows a blank Select. */
export function LocalizationSection( props : LocalizationSection.Props )
{
    /** Split the comma-separated country-codes text back into the array. */
    function onCountriesChange( event : React.ChangeEvent<HTMLInputElement> ) : void
    {
        const codes : Array<string> = event.target.value
            .split( "," )
            .map( ( entry : string ) : string => entry.trim().toUpperCase() )
            .filter( ( entry : string ) : boolean => entry !== "" );
        props.onChange( codes, props.country );
    }

    const options : Array<string> = props.countries.includes( props.country ) ? props.countries : [ props.country, ...props.countries ];

    return (
        <ConfigSection title="Localization" hint="Countries offered in the signup/account country picker.">
            <Box>
                <Typography variant="body2">Countries</Typography>
                <Typography variant="caption" sx={{ color: "text.disabled" }}>Comma-separated ISO country codes, e.g. "US, CA, GB".</Typography>
                <TextField
                    fullWidth size="small" disabled={props.readOnly}
                    value={props.countries.join( ", " )}
                    onChange={onCountriesChange}
                    sx={{ mt: 0.5 }}
                />
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Typography variant="body2">Default country</Typography>
                <Select
                    size="small" value={props.country} disabled={props.readOnly}
                    onChange={( event : SelectChangeEvent ) : void => props.onChange( props.countries, event.target.value )}
                    sx={{ minWidth: 120 }}
                >
                    {options.map( ( code : string ) => <MenuItem key={code} value={code}>{code}</MenuItem> )}
                </Select>
            </Box>
        </ConfigSection>
    );
}

export namespace LocalizationSection
{
    export interface Props
    {
        countries : Array<string>;
        country   : string;
        onChange  : ( countries : Array<string>, country : string ) => void;
        readOnly  : boolean;
    }
}

export default LocalizationSection;
