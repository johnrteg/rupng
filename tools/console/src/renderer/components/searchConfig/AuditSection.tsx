import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Switch from "@mui/material/Switch";
import type { SelectChangeEvent } from "@mui/material/Select";
import { SearchConfig } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";

/** Query-audit posture (search-5.3) — whether queries are logged at all, how much of each query is
 *  captured, and how long the audit trail is retained. */
export function AuditSection( props : AuditSection.Props )
{
    /** Patch one field of the audit config, preserving the rest. */
    function set( patch : Partial<SearchConfig.AuditConfig> ) : void
    {
        props.onChange( { ...props.value, ...patch } );
    }

    /** Switch the audit scope between metadata-only and full (query text included). */
    function onScopeChange( event : SelectChangeEvent ) : void
    {
        set( { scope: event.target.value as SearchConfig.AuditScope } );
    }

    return (
        <ConfigSection title="Query audit" hint="Whether search queries are logged, how much of each query is captured, and for how long.">
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
                <Box>
                    <Typography variant="body2">Enabled</Typography>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>Records who/when/type/result-count for every query.</Typography>
                </Box>
                <Switch checked={props.value.enabled} disabled={props.readOnly} onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => set( { enabled: event.target.checked } )} />
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
                <Box>
                    <Typography variant="body2">Scope</Typography>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>metadata = never stores the raw query text. full = additionally stores the query string.</Typography>
                </Box>
                <Select size="small" value={props.value.scope} disabled={props.readOnly || !props.value.enabled} onChange={onScopeChange} sx={{ minWidth: 150 }}>
                    {Object.values( SearchConfig.AuditScope ).map( ( scope : SearchConfig.AuditScope ) => <MenuItem key={scope} value={scope}>{scope}</MenuItem> )}
                </Select>
            </Box>
            <RangeNumberField
                label="Retention (seconds)" help="How long an audit entry is kept before it expires." value={props.value.ttlSeconds} min={0} disabled={props.readOnly || !props.value.enabled}
                onChange={( value : number ) : void => set( { ttlSeconds: value } )}
            />
        </ConfigSection>
    );
}

export namespace AuditSection
{
    export interface Props
    {
        value    : SearchConfig.AuditConfig;
        onChange : ( value : SearchConfig.AuditConfig ) => void;
        readOnly : boolean;
    }
}

export default AuditSection;
