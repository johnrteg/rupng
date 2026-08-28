import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Switch from "@mui/material/Switch";
import type { SelectChangeEvent } from "@mui/material/Select";
import { AuthConfig } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";

// the closed set AuthConfig.SCHEMA enforces for `sso.providers` — kept in sync with AuthConfig.ts by hand
// since the wire type is `Array<string>`, not a formal enum (see CLAUDE.md note on this editor).
const SSO_PROVIDERS : Array<string> = [ "google", "microsoft", "apple" ];

/** SSO / federation (auth-5) — which social providers are enabled, whether a new account defaults to
 *  SSO-only enforcement, and whether directory-driven (SCIM) provisioning is on. */
export function SsoSection( props : SsoSection.Props )
{
    /** Patch one field of the SSO config, preserving the rest. */
    function set( patch : Partial<AuthConfig.Sso> ) : void
    {
        props.onChange( { ...props.value, ...patch } );
    }

    /** Update the enabled-providers multi-select. */
    function onProvidersChange( event : SelectChangeEvent<Array<string>> ) : void
    {
        const value : Array<string> | string = event.target.value;
        set( { providers: typeof value === "string" ? value.split( "," ) : value } );
    }

    return (
        <ConfigSection title="SSO" hint="Social / federated sign-in.">
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Typography variant="body2">Enabled providers</Typography>
                <Select
                    size="small" multiple value={props.value.providers} disabled={props.readOnly}
                    onChange={onProvidersChange}
                    renderValue={( selected : Array<string> ) : string => selected.join( ", " )}
                    sx={{ minWidth: 180 }}
                >
                    {SSO_PROVIDERS.map( ( provider : string ) => <MenuItem key={provider} value={provider}>{provider}</MenuItem> )}
                </Select>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Box>
                    <Typography variant="body2">SSO-only default</Typography>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>New account default for SSO-only enforcement.</Typography>
                </Box>
                <Switch checked={props.value.ssoOnlyDefault} disabled={props.readOnly} onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => set( { ssoOnlyDefault: event.target.checked } )} />
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Box>
                    <Typography variant="body2">SCIM provisioning</Typography>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>Directory-driven user provisioning.</Typography>
                </Box>
                <Switch checked={props.value.scimEnabled} disabled={props.readOnly} onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => set( { scimEnabled: event.target.checked } )} />
            </Box>
        </ConfigSection>
    );
}

export namespace SsoSection
{
    export interface Props
    {
        value    : AuthConfig.Sso;
        onChange : ( value : AuthConfig.Sso ) => void;
        readOnly : boolean;
    }
}

export default SsoSection;
