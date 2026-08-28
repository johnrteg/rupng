import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Switch from "@mui/material/Switch";
import type { SelectChangeEvent } from "@mui/material/Select";
import { AuthConfig, MfaMethod } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";

/** Multi-factor policy (auth-3) — which factors are allowed, whether MFA is optional/required/off, and
 *  whether a sensitive operation re-challenges (step-up) even for an already-authenticated session. */
export function MfaSection( props : MfaSection.Props )
{
    /** Patch one field of the MFA config, preserving the rest. */
    function set( patch : Partial<AuthConfig.Mfa> ) : void
    {
        props.onChange( { ...props.value, ...patch } );
    }

    /** Update the allowed-methods multi-select. */
    function onMethodsChange( event : SelectChangeEvent<Array<MfaMethod>> ) : void
    {
        const value : Array<MfaMethod> | string = event.target.value;
        set( { methods: typeof value === "string" ? value.split( "," ) as Array<MfaMethod> : value } );
    }

    return (
        <ConfigSection title="MFA" hint="Multi-factor authentication policy.">
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Box>
                    <Typography variant="body2">Allowed methods</Typography>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>Factors a user may register/challenge with.</Typography>
                </Box>
                <Select
                    size="small" multiple value={props.value.methods} disabled={props.readOnly}
                    onChange={onMethodsChange}
                    renderValue={( selected : Array<MfaMethod> ) : string => selected.join( ", " )}
                    sx={{ minWidth: 180 }}
                >
                    {Object.values( MfaMethod ).map( ( method : MfaMethod ) => <MenuItem key={method} value={method}>{method}</MenuItem> )}
                </Select>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Box>
                    <Typography variant="body2">Enforcement</Typography>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>Whether MFA is required at sign-in.</Typography>
                </Box>
                <Select
                    size="small" value={props.value.enforcement} disabled={props.readOnly}
                    onChange={( event : SelectChangeEvent ) : void => set( { enforcement: event.target.value as AuthConfig.Mfa[ "enforcement" ] } )}
                    sx={{ minWidth: 150 }}
                >
                    <MenuItem value="off">off</MenuItem>
                    <MenuItem value="optional">optional</MenuItem>
                    <MenuItem value="required">required</MenuItem>
                </Select>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Box>
                    <Typography variant="body2">Step-up on elevation</Typography>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>Re-challenge for sensitive operations even mid-session.</Typography>
                </Box>
                <Switch
                    checked={props.value.stepUpOnElevation} disabled={props.readOnly}
                    onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => set( { stepUpOnElevation: event.target.checked } )}
                />
            </Box>
        </ConfigSection>
    );
}

export namespace MfaSection
{
    export interface Props
    {
        value    : AuthConfig.Mfa;
        onChange : ( value : AuthConfig.Mfa ) => void;
        readOnly : boolean;
    }
}

export default MfaSection;
