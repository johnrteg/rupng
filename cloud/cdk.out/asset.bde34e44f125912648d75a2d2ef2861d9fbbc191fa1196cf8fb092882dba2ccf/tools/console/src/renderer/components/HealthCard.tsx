import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import Tooltip from "@mui/material/Tooltip";
import CircularProgress from "@mui/material/CircularProgress";
import FavoriteIcon from "@mui/icons-material/Favorite";

import type { HealthResult, ServiceInfo } from "../../shared/types";
import { api } from "../api";
import { MONO } from "../theme";

//
// Health panel: a /health ping per role, showing status, latency, and the response body.
//
export function HealthCard(
    { service, results, onResults } :
    { service : ServiceInfo; results : HealthResult[]; onResults : ( r : HealthResult[] ) => void }
)
{
    const [ busy, setBusy ] = useState<boolean>( false );

    const ping = async () : Promise<void> =>
    {
        setBusy( true );
        try { onResults( await api.pingHealth( service.id ) ); }
        finally { setBusy( false ); }
    };

    if ( !service.capabilities.canHealth )
    {
        return (
            <Box sx={{ p: 1.5 }}>
                <Typography variant="caption" sx={{ color: "text.disabled" }}>
                    No HTTP health endpoint{service.capabilities.isFrontend ? " (frontend)" : ""}.
                </Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, flexGrow: 1 }}>Health</Typography>
                <Button
                    size="small"
                    variant="outlined"
                    startIcon={busy ? <CircularProgress size={13} /> : <FavoriteIcon fontSize="small" />}
                    onClick={ping}
                >
                    Ping
                </Button>
            </Box>

            {service.roles.map( ( role ) =>
            {
                const r : HealthResult | undefined = results.find( ( x ) => x.role === role.role );
                return (
                    <Box key={role.role} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1.5, p: 1 }}>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                            <Chip
                                label={r ? ( r.ok ? `${r.status} OK` : ( r.error ?? `${r.status}` ) ) : "—"}
                                color={r ? ( r.ok ? "success" : "error" ) : "default"}
                                variant={r ? "filled" : "outlined"}
                            />
                            <Typography variant="caption" sx={{ fontFamily: MONO, color: "text.secondary", flexGrow: 1 }}>
                                {role.role} · :{role.port}/health
                            </Typography>
                            {r && <Typography variant="caption" sx={{ color: "text.disabled" }}>{r.latencyMs}ms</Typography>}
                        </Box>
                        {r && ( r.body !== undefined && r.body !== "" ) && (
                            <Tooltip title="response body">
                                <Box
                                    component="pre"
                                    sx={{ m: 0, mt: 0.5, fontFamily: MONO, fontSize: 11, color: "text.secondary",
                                          whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 120, overflow: "auto" }}
                                >
                                    {typeof r.body === "string" ? r.body : JSON.stringify( r.body, null, 2 )}
                                </Box>
                            </Tooltip>
                        )}
                    </Box>
                );
            } )}
        </Box>
    );
}
