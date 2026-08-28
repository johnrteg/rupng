import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Switch from "@mui/material/Switch";
import type { SelectChangeEvent } from "@mui/material/Select";
import { Email, EmailConfig } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";

/** Which provider handles ACCOUNT sends vs. PLATFORM/system mail (reset, verification), and whether
 *  account-installed marketplace providers are allowed at all. */
export function ProvidersSection( props : ProvidersSection.Props )
{
    return (
        <ConfigSection title="Providers" hint="Default sending routes. The provider itself is configured (secrets/enabled) below in Provider registry.">
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Box>
                    <Typography variant="body2">Default provider</Typography>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>Used for account (customer) sends unless an account overrides it.</Typography>
                </Box>
                <Select
                    size="small" value={props.value.defaultProvider} disabled={props.readOnly}
                    onChange={( event : SelectChangeEvent ) : void => props.onChange( { ...props.value, defaultProvider: event.target.value as Email.Provider } )}
                    sx={{ minWidth: 150 }}
                >
                    {Object.values( Email.Provider ).map( ( provider : Email.Provider ) => <MenuItem key={provider} value={provider}>{provider}</MenuItem> )}
                </Select>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Box>
                    <Typography variant="body2">System provider</Typography>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>Used for platform mail — password reset, verification, MFA codes.</Typography>
                </Box>
                <Select
                    size="small" value={props.value.systemProvider} disabled={props.readOnly}
                    onChange={( event : SelectChangeEvent ) : void => props.onChange( { ...props.value, systemProvider: event.target.value as Email.Provider } )}
                    sx={{ minWidth: 150 }}
                >
                    {Object.values( Email.Provider ).map( ( provider : Email.Provider ) => <MenuItem key={provider} value={provider}>{provider}</MenuItem> )}
                </Select>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Box>
                    <Typography variant="body2">Marketplace providers</Typography>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>Allow accounts to install their own provider instead of the platform default.</Typography>
                </Box>
                <Switch
                    checked={props.value.marketplaceEnabled} disabled={props.readOnly}
                    onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => props.onChange( { ...props.value, marketplaceEnabled: event.target.checked } )}
                />
            </Box>
        </ConfigSection>
    );
}

export namespace ProvidersSection
{
    export interface Props
    {
        value    : EmailConfig.Config;
        onChange : ( value : EmailConfig.Config ) => void;
        readOnly : boolean;
    }
}

export default ProvidersSection;
