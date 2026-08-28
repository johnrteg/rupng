import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Switch from "@mui/material/Switch";
import { AuthConfig } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";

/** Token + session lifetimes (auth-6, auth-7) — access/refresh TTLs, whether the refresh token rotates on
 *  use (reuse-detection), the server-side idle window, and the concurrent-session cap. */
export function TokensSection( props : TokensSection.Props )
{
    /** Patch one field of the tokens config, preserving the rest. */
    function set( patch : Partial<AuthConfig.Tokens> ) : void
    {
        props.onChange( { ...props.value, ...patch } );
    }

    return (
        <ConfigSection title="Tokens & sessions" hint="Token lifetimes and session limits.">
            <RangeNumberField
                label="Access TTL (sec)" value={props.value.accessTtlSeconds} min={1} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { accessTtlSeconds: value } )}
            />
            <RangeNumberField
                label="Refresh TTL (sec)" value={props.value.refreshTtlSeconds} min={1} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { refreshTtlSeconds: value } )}
            />
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Box>
                    <Typography variant="body2">Rotate refresh</Typography>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>Rotate the refresh token on use (enables reuse-detection).</Typography>
                </Box>
                <Switch
                    checked={props.value.rotateRefresh} disabled={props.readOnly}
                    onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => set( { rotateRefresh: event.target.checked } )}
                />
            </Box>
            <RangeNumberField
                label="Idle timeout (sec)" help="Server-side idle window." value={props.value.idleTimeoutSeconds} min={1} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { idleTimeoutSeconds: value } )}
            />
            <RangeNumberField
                label="Max concurrent sessions" value={props.value.maxConcurrentSessions} min={1} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { maxConcurrentSessions: value } )}
            />
        </ConfigSection>
    );
}

export namespace TokensSection
{
    export interface Props
    {
        value    : AuthConfig.Tokens;
        onChange : ( value : AuthConfig.Tokens ) => void;
        readOnly : boolean;
    }
}

export default TokensSection;
