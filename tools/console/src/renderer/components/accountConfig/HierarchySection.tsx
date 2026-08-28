import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import type { SelectChangeEvent } from "@mui/material/Select";
import { AccountConfig } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";

/** Sub-account hierarchy (account-2) — how deep sub-accounts may nest, the fan-out cap per parent, and
 *  whether a new sub-account defaults to open or granted parent access. */
export function HierarchySection( props : HierarchySection.Props )
{
    /** Patch one field of the hierarchy config, preserving the rest. */
    function set( patch : Partial<AccountConfig.Hierarchy> ) : void
    {
        props.onChange( { ...props.value, ...patch } );
    }

    return (
        <ConfigSection title="Hierarchy" hint="Sub-account nesting limits.">
            <RangeNumberField
                label="Max depth" help="How deep sub-accounts may nest." value={props.value.maxDepth} min={1} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { maxDepth: value } )}
            />
            <RangeNumberField
                label="Max sub-accounts / parent" help="Fan-out cap per parent account." value={props.value.maxSubAccountsPerParent} min={1} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { maxSubAccountsPerParent: value } )}
            />
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Box>
                    <Typography variant="body2">Default parent access</Typography>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>A new sub-account's default `parentAccess` setting.</Typography>
                </Box>
                <Select
                    size="small" value={props.value.defaultParentAccess} disabled={props.readOnly}
                    onChange={( event : SelectChangeEvent ) : void => set( { defaultParentAccess: event.target.value as AccountConfig.Hierarchy[ "defaultParentAccess" ] } )}
                    sx={{ minWidth: 150 }}
                >
                    <MenuItem value="open">open</MenuItem>
                    <MenuItem value="granted">granted</MenuItem>
                </Select>
            </Box>
        </ConfigSection>
    );
}

export namespace HierarchySection
{
    export interface Props
    {
        value    : AccountConfig.Hierarchy;
        onChange : ( value : AccountConfig.Hierarchy ) => void;
        readOnly : boolean;
    }
}

export default HierarchySection;
