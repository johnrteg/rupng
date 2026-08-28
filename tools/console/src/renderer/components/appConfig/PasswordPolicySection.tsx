import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Switch from "@mui/material/Switch";
import { PasswordPolicy } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";

/** Password composition rules — the web client renders + pre-validates against this SAME rule the auth
 *  service enforces. */
export function PasswordPolicySection( props : PasswordPolicySection.Props )
{
    /** Patch one field of the password policy, preserving the rest. */
    function set( patch : Partial<PasswordPolicy.Rule> ) : void
    {
        props.onChange( { ...props.value, ...patch } );
    }

    return (
        <ConfigSection title="Password policy" hint="Composition rules — must match what auth enforces server-side.">
            <RangeNumberField
                label="Min length" value={props.value.minLength} min={1} max={256} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { minLength: value } )}
            />
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Typography variant="body2">Require uppercase</Typography>
                <Switch checked={props.value.requireUpper ?? false} disabled={props.readOnly} onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => set( { requireUpper: event.target.checked } )} />
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Typography variant="body2">Require lowercase</Typography>
                <Switch checked={props.value.requireLower ?? false} disabled={props.readOnly} onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => set( { requireLower: event.target.checked } )} />
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Typography variant="body2">Require number</Typography>
                <Switch checked={props.value.requireNumber ?? false} disabled={props.readOnly} onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => set( { requireNumber: event.target.checked } )} />
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Typography variant="body2">Require symbol</Typography>
                <Switch checked={props.value.requireSymbol ?? false} disabled={props.readOnly} onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => set( { requireSymbol: event.target.checked } )} />
            </Box>
        </ConfigSection>
    );
}

export namespace PasswordPolicySection
{
    export interface Props
    {
        value    : PasswordPolicy.Rule;
        onChange : ( value : PasswordPolicy.Rule ) => void;
        readOnly : boolean;
    }
}

export default PasswordPolicySection;
