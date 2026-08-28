import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import type { SelectChangeEvent } from "@mui/material/Select";
import { AccountConfig } from "@repo/api";
import { Access } from "@repo/system";
import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";

/** Membership defaults (account-3) — invite expiry, and the role a new member starts at / can be granted
 *  up to. `defaultRole`/`defaultMaxRole` are plain strings on the wire (an operator could type an
 *  unregistered role), but the account ladder (`Access.AccountRole`) is the actual closed set — offer it
 *  as the picker's options so a typo can't slip in via the smart editor. */
export function MembershipSection( props : MembershipSection.Props )
{
    /** Patch one field of the membership config, preserving the rest. */
    function set( patch : Partial<AccountConfig.Membership> ) : void
    {
        props.onChange( { ...props.value, ...patch } );
    }

    return (
        <ConfigSection title="Membership" hint="Defaults for a newly-invited member. The per-plan member CAP is a billing entitlement, not here.">
            <RangeNumberField
                label="Invite expiry (hours)" value={props.value.inviteExpiryHours} min={1} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { inviteExpiryHours: value } )}
            />
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Box>
                    <Typography variant="body2">Default role</Typography>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>Role a new member receives.</Typography>
                </Box>
                <Select
                    size="small" value={props.value.defaultRole} disabled={props.readOnly}
                    onChange={( event : SelectChangeEvent ) : void => set( { defaultRole: event.target.value } )}
                    sx={{ minWidth: 150 }}
                >
                    {Object.values( Access.AccountRole ).map( ( role : Access.AccountRole ) => <MenuItem key={role} value={role}>{role}</MenuItem> )}
                </Select>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Box>
                    <Typography variant="body2">Default max role</Typography>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>The ceiling a new member may be granted up to.</Typography>
                </Box>
                <Select
                    size="small" value={props.value.defaultMaxRole} disabled={props.readOnly}
                    onChange={( event : SelectChangeEvent ) : void => set( { defaultMaxRole: event.target.value } )}
                    sx={{ minWidth: 150 }}
                >
                    {Object.values( Access.AccountRole ).map( ( role : Access.AccountRole ) => <MenuItem key={role} value={role}>{role}</MenuItem> )}
                </Select>
            </Box>
        </ConfigSection>
    );
}

export namespace MembershipSection
{
    export interface Props
    {
        value    : AccountConfig.Membership;
        onChange : ( value : AccountConfig.Membership ) => void;
        readOnly : boolean;
    }
}

export default MembershipSection;
