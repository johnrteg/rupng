import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import type { SelectChangeEvent } from "@mui/material/Select";
import { AuthConfig } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";

/** WebAuthn / passkey relying-party config (auth-4). Origins must match the served web origin — a
 *  mismatch here silently breaks every passkey registration/assertion. */
export function WebAuthnSection( props : WebAuthnSection.Props )
{
    /** Patch one field of the WebAuthn config, preserving the rest. */
    function set( patch : Partial<AuthConfig.WebAuthn> ) : void
    {
        props.onChange( { ...props.value, ...patch } );
    }

    /** Split the comma-separated origins text back into the array. */
    function onOriginsChange( event : React.ChangeEvent<HTMLInputElement> ) : void
    {
        const origins : Array<string> = event.target.value
            .split( "," )
            .map( ( entry : string ) : string => entry.trim() )
            .filter( ( entry : string ) : boolean => entry !== "" );
        set( { origins } );
    }

    return (
        <ConfigSection title="WebAuthn / passkeys" hint="Relying-party config. Origins MUST match the served web origin exactly.">
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Typography variant="body2">RP name</Typography>
                <TextField
                    size="small" value={props.value.rpName} disabled={props.readOnly}
                    onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => set( { rpName: event.target.value } )}
                    sx={{ width: 180 }}
                />
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Box>
                    <Typography variant="body2">RP ID</Typography>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>The registrable domain, e.g. "rumbleup.com" or "localhost".</Typography>
                </Box>
                <TextField
                    size="small" value={props.value.rpId} disabled={props.readOnly}
                    onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => set( { rpId: event.target.value } )}
                    sx={{ width: 180 }}
                />
            </Box>
            <Box>
                <Typography variant="body2">Allowed origins</Typography>
                <Typography variant="caption" sx={{ color: "text.disabled" }}>Comma-separated, e.g. "https://app.rumbleup.com".</Typography>
                <TextField
                    fullWidth size="small" disabled={props.readOnly}
                    value={props.value.origins.join( ", " )}
                    onChange={onOriginsChange}
                    sx={{ mt: 0.5 }}
                />
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Typography variant="body2">User verification</Typography>
                <Select
                    size="small" value={props.value.userVerification} disabled={props.readOnly}
                    onChange={( event : SelectChangeEvent ) : void => set( { userVerification: event.target.value as AuthConfig.WebAuthn[ "userVerification" ] } )}
                    sx={{ minWidth: 150 }}
                >
                    <MenuItem value="preferred">preferred</MenuItem>
                    <MenuItem value="required">required</MenuItem>
                    <MenuItem value="discouraged">discouraged</MenuItem>
                </Select>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Typography variant="body2">Resident key</Typography>
                <Select
                    size="small" value={props.value.residentKey} disabled={props.readOnly}
                    onChange={( event : SelectChangeEvent ) : void => set( { residentKey: event.target.value as AuthConfig.WebAuthn[ "residentKey" ] } )}
                    sx={{ minWidth: 150 }}
                >
                    <MenuItem value="preferred">preferred</MenuItem>
                    <MenuItem value="required">required</MenuItem>
                    <MenuItem value="discouraged">discouraged</MenuItem>
                </Select>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Typography variant="body2">Attestation</Typography>
                <Select
                    size="small" value={props.value.attestation} disabled={props.readOnly}
                    onChange={( event : SelectChangeEvent ) : void => set( { attestation: event.target.value as AuthConfig.WebAuthn[ "attestation" ] } )}
                    sx={{ minWidth: 150 }}
                >
                    <MenuItem value="none">none</MenuItem>
                    <MenuItem value="direct">direct</MenuItem>
                    <MenuItem value="indirect">indirect</MenuItem>
                    <MenuItem value="enterprise">enterprise</MenuItem>
                </Select>
            </Box>
        </ConfigSection>
    );
}

export namespace WebAuthnSection
{
    export interface Props
    {
        value    : AuthConfig.WebAuthn;
        onChange : ( value : AuthConfig.WebAuthn ) => void;
        readOnly : boolean;
    }
}

export default WebAuthnSection;
