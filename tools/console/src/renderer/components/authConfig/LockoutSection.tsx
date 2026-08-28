import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Switch from "@mui/material/Switch";
import { AuthConfig } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";

/** Failed-login lockout + adaptive risk (RISK.md) — how many fails trigger a lock, the escalating lock
 *  durations, how many repeated locks force a hard-disable, and whether MFA is demanded on anomalous sign-in. */
export function LockoutSection( props : LockoutSection.Props )
{
    /** Patch one field of the lockout config, preserving the rest. */
    function set( patch : Partial<AuthConfig.Lockout> ) : void
    {
        props.onChange( { ...props.value, ...patch } );
    }

    /** Parse the comma-separated backoff-minutes text back into a number array (ignores non-numeric entries). */
    function onBackoffChange( event : React.ChangeEvent<HTMLInputElement> ) : void
    {
        const minutes : Array<number> = event.target.value
            .split( "," )
            .map( ( entry : string ) : number => Number( entry.trim() ) )
            .filter( ( entry : number ) : boolean => !Number.isNaN( entry ) );
        set( { backoffMinutes: minutes } );
    }

    return (
        <ConfigSection title="Lockout" hint="Failed-login lockout policy.">
            <RangeNumberField
                label="Max failed attempts" value={props.value.maxFailedAttempts} min={1} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { maxFailedAttempts: value } )}
            />
            <Box>
                <Typography variant="body2">Backoff (minutes)</Typography>
                <Typography variant="caption" sx={{ color: "text.disabled" }}>Comma-separated escalating lock durations, e.g. "5, 10, 20".</Typography>
                <TextField
                    fullWidth size="small" disabled={props.readOnly}
                    value={props.value.backoffMinutes.join( ", " )}
                    onChange={onBackoffChange}
                    sx={{ mt: 0.5 }}
                />
            </Box>
            <RangeNumberField
                label="Lockouts before disable" help="Repeated locks force a hard-disable + notify admins." value={props.value.lockoutsBeforeDisable} min={1} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { lockoutsBeforeDisable: value } )}
            />
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Box>
                    <Typography variant="body2">Adaptive MFA</Typography>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>Require MFA on an anomalous (new device/geo) sign-in.</Typography>
                </Box>
                <Switch
                    checked={props.value.adaptiveMfa} disabled={props.readOnly}
                    onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => set( { adaptiveMfa: event.target.checked } )}
                />
            </Box>
        </ConfigSection>
    );
}

export namespace LockoutSection
{
    export interface Props
    {
        value    : AuthConfig.Lockout;
        onChange : ( value : AuthConfig.Lockout ) => void;
        readOnly : boolean;
    }
}

export default LockoutSection;
