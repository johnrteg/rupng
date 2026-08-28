import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Switch from "@mui/material/Switch";
import { AuthConfig } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";

/** One abuse-control rate-limit tier — steady-state (per minute) and burst caps for one sensitive surface. */
function RateLimitRow( props : RateLimitRow.Props )
{
    return (
        <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 1 }}>
            <Typography variant="caption" sx={{ color: "text.disabled", textTransform: "uppercase" }}>{props.label}</Typography>
            <RangeNumberField
                label="Per minute" value={props.value.perMinute} min={0} disabled={props.readOnly}
                onChange={( value : number ) : void => props.onChange( { ...props.value, perMinute: value } )}
            />
            <RangeNumberField
                label="Burst" value={props.value.burst} min={0} disabled={props.readOnly}
                onChange={( value : number ) : void => props.onChange( { ...props.value, burst: value } )}
            />
        </Box>
    );
}

namespace RateLimitRow
{
    export interface Props
    {
        label    : string;
        value    : AuthConfig.RateLimit;
        onChange : ( value : AuthConfig.RateLimit ) => void;
        readOnly : boolean;
    }
}

/** Abuse controls — per-IP/per-identity rate limits on the sensitive surfaces (login, register, reset,
 *  verification resend). */
export function AbuseSection( props : AbuseSection.Props )
{
    /** Patch one field of the abuse config, preserving the rest. */
    function set( patch : Partial<AuthConfig.Abuse> ) : void
    {
        props.onChange( { ...props.value, ...patch } );
    }

    return (
        <ConfigSection title="Abuse controls" hint="Rate limits on the sensitive surfaces.">
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Typography variant="body2">Limit by IP</Typography>
                <Switch checked={props.value.byIp} disabled={props.readOnly} onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => set( { byIp: event.target.checked } )} />
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Typography variant="body2">Limit by identity</Typography>
                <Switch checked={props.value.byIdentity} disabled={props.readOnly} onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => set( { byIdentity: event.target.checked } )} />
            </Box>
            <RateLimitRow label="Login" value={props.value.login} readOnly={props.readOnly} onChange={( value : AuthConfig.RateLimit ) : void => set( { login: value } )} />
            <RateLimitRow label="Register" value={props.value.register} readOnly={props.readOnly} onChange={( value : AuthConfig.RateLimit ) : void => set( { register: value } )} />
            <RateLimitRow label="Password reset" value={props.value.reset} readOnly={props.readOnly} onChange={( value : AuthConfig.RateLimit ) : void => set( { reset: value } )} />
            <RateLimitRow label="Code resend" value={props.value.resend} readOnly={props.readOnly} onChange={( value : AuthConfig.RateLimit ) : void => set( { resend: value } )} />
        </ConfigSection>
    );
}

export namespace AbuseSection
{
    export interface Props
    {
        value    : AuthConfig.Abuse;
        onChange : ( value : AuthConfig.Abuse ) => void;
        readOnly : boolean;
    }
}

export default AbuseSection;
