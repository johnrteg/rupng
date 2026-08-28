import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Switch from "@mui/material/Switch";
import { AuthConfig } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";

/** Contact verification (email/phone codes) — code length/TTL, resend cooldown, and whether email/phone
 *  verification is required before activation/signup. */
export function VerificationSection( props : VerificationSection.Props )
{
    /** Patch one field of the verification config, preserving the rest. */
    function set( patch : Partial<AuthConfig.Verification> ) : void
    {
        props.onChange( { ...props.value, ...patch } );
    }

    return (
        <ConfigSection title="Verification" hint="Email/phone contact-verification codes.">
            <RangeNumberField
                label="Code length" value={props.value.codeLength} min={4} max={12} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { codeLength: value } )}
            />
            <RangeNumberField
                label="Code TTL (sec)" value={props.value.codeTtlSeconds} min={1} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { codeTtlSeconds: value } )}
            />
            <RangeNumberField
                label="Resend cooldown (sec)" value={props.value.resendCooldownSeconds} min={0} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { resendCooldownSeconds: value } )}
            />
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Typography variant="body2">Email required</Typography>
                <Switch
                    checked={props.value.emailRequired} disabled={props.readOnly}
                    onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => set( { emailRequired: event.target.checked } )}
                />
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Typography variant="body2">Phone required</Typography>
                <Switch
                    checked={props.value.phoneRequired} disabled={props.readOnly}
                    onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => set( { phoneRequired: event.target.checked } )}
                />
            </Box>
        </ConfigSection>
    );
}

export namespace VerificationSection
{
    export interface Props
    {
        value    : AuthConfig.Verification;
        onChange : ( value : AuthConfig.Verification ) => void;
        readOnly : boolean;
    }
}

export default VerificationSection;
