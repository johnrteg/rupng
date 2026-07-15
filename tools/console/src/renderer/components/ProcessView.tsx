import { useEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import RefreshIcon from "@mui/icons-material/Refresh";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import StopCircleIcon from "@mui/icons-material/StopCircle";

import type { ProcessListing, RupProcess } from "../../shared/types";
import { api } from "../api";
import { MONO } from "../theme";

//
// ProcessView — the Processes sub-tab. Scans the OS for every rup-related process (service dev servers,
// the web/vite dev server, a top-level `turbo run dev`, cdklocal, the webproxy) — not just the ones THIS
// console session spawned. Each is tagged OWNED (current session) or ORPHAN (a prior session / a manual
// dev run that can shadow ports + run with stale env). Kill one, or "Reap all stale" to clear orphans.
//

/** Human age: "12s", "3m", "1h 04m". */
function ageOf( seconds : number ) : string
{
    if ( seconds < 60 ) return `${seconds}s`;
    const minutes : number = Math.floor( seconds / 60 );
    if ( minutes < 60 ) return `${minutes}m`;
    const hours : number = Math.floor( minutes / 60 );
    return `${hours}h ${String( minutes % 60 ).padStart( 2, "0" )}m`;
}

/** Short label for a process kind. */
function kindLabel( process : RupProcess ) : string
{
    switch ( process.kind )
    {
        case "service":  return process.role ? `${process.service ?? "service"}:${process.role}` : ( process.service ?? "service" );
        case "proxy":    return "webproxy";
        case "web":      return "web (vite)";
        case "turbo":    return "turbo run dev";
        case "cdklocal": return "cdklocal";
        default:         return process.service ?? "process";
    }
}

export function ProcessView()
{
    const [ listing, setListing ] = useState<ProcessListing | null>( null );
    const [ busy, setBusy ] = useState<boolean>( false );
    const [ auto, setAuto ] = useState<boolean>( true );
    const timer = useRef<ReturnType<typeof setInterval> | null>( null );

    /** Pull the current process listing into state. */
    async function refresh() : Promise<void> { setListing( await api.processList() ); }

    /** Kill one process tree, then refresh. */
    async function kill( pid : number ) : Promise<void> { setBusy( true ); try { await api.processKill( pid ); } finally { setBusy( false ); } await refresh(); }

    /** Reap every orphan/stale tree, then refresh. */
    async function reapAll() : Promise<void> { setBusy( true ); try { await api.processReap(); } finally { setBusy( false ); } await refresh(); }

    useEffect( () =>
    {
        void refresh();
        return () => { if ( timer.current ) clearInterval( timer.current ); };
    }, [] );

    useEffect( () =>
    {
        if ( timer.current ) { clearInterval( timer.current ); timer.current = null; }
        if ( auto ) timer.current = setInterval( () => { void refresh(); }, 5000 );
        return () => { if ( timer.current ) clearInterval( timer.current ); };
    }, [ auto ] );

    const processes : Array<RupProcess> = listing?.processes ?? [];
    const orphans : number = useMemo( () => processes.filter( ( p ) => !p.owned ).length, [ processes ] );

    return (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>

            {/* toolbar */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider", flexWrap: "wrap" }}>
                <Typography variant="subtitle2" sx={{ fontFamily: MONO }}>Processes — rup dev/runtime</Typography>
                <Chip size="small" variant="outlined"
                      color={listing ? ( listing.ok ? "success" : "error" ) : "default"}
                      label={listing ? ( listing.ok ? `${processes.length} found · ${orphans} orphan` : listing.error ?? "error" ) : "loading…"}
                      sx={{ fontFamily: MONO }} />
                <Box sx={{ flexGrow: 1 }} />
                <Button size="small" variant={auto ? "contained" : "outlined"} onClick={() => setAuto( !auto )}>
                    {auto ? "Auto ⟳" : "Auto off"}
                </Button>
                <Tooltip title="Kill all orphan/stale process trees (owned processes are left alone)">
                    <span>
                        <Button size="small" color="error" variant="outlined" startIcon={<DeleteSweepIcon fontSize="small" />}
                                disabled={busy || orphans === 0} onClick={() => void reapAll()}>
                            Reap stale ({orphans})
                        </Button>
                    </span>
                </Tooltip>
                <Tooltip title="Refresh"><IconButton size="small" onClick={() => void refresh()}><RefreshIcon fontSize="small" /></IconButton></Tooltip>
            </Box>

            {/* error hint */}
            {listing && !listing.ok && (
                <Box sx={{ p: 2 }}>
                    <Typography variant="body2" sx={{ color: "warning.main" }}>{listing.error}</Typography>
                </Box>
            )}

            {listing?.ok && processes.length === 0 && (
                <Box sx={{ p: 2 }}>
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>No rup processes running.</Typography>
                </Box>
            )}

            {/* process table */}
            {listing?.ok && processes.length > 0 && (
                <Box sx={{ flexGrow: 1, minHeight: 0, overflow: "auto" }}>
                    <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", fontFamily: MONO, fontSize: 12,
                                                 "& td, & th": { px: 1.5, py: 0.75, textAlign: "left", borderBottom: "1px solid", borderColor: "divider", whiteSpace: "nowrap" } }}>
                        <Box component="thead" sx={{ color: "text.secondary" }}>
                            <Box component="tr">
                                <Box component="th">State</Box>
                                <Box component="th">What</Box>
                                <Box component="th">PID</Box>
                                <Box component="th">Port</Box>
                                <Box component="th">Age</Box>
                                <Box component="th" sx={{ width: "100%" }}>Command</Box>
                                <Box component="th" />
                            </Box>
                        </Box>
                        <Box component="tbody">
                            {processes.map( ( p ) => (
                                <Box component="tr" key={p.pid} sx={{ "&:hover": { bgcolor: "action.hover" }, opacity: p.owned ? 1 : 0.92 }}>
                                    <Box component="td">
                                        <Chip size="small" variant={p.owned ? "filled" : "outlined"} color={p.owned ? "success" : "warning"}
                                              label={p.owned ? "owned" : "orphan"} sx={{ fontFamily: MONO, fontSize: 10, height: 18 }} />
                                    </Box>
                                    <Box component="td" sx={{ fontWeight: 600 }}>{kindLabel( p )}</Box>
                                    <Box component="td" sx={{ color: "text.secondary" }}>{p.pid}</Box>
                                    <Box component="td" sx={{ color: p.port ? "info.main" : "text.disabled" }}>{p.port ?? "—"}</Box>
                                    <Box component="td" sx={{ color: "text.secondary" }}>{ageOf( p.ageSec )}</Box>
                                    <Box component="td" sx={{ color: "text.disabled", fontSize: 10, maxWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                                        <Tooltip title={p.command}><span>{p.command}</span></Tooltip>
                                    </Box>
                                    <Box component="td">
                                        <Tooltip title={p.owned ? "Kill this (current-session) process tree" : "Kill this orphan process tree"}>
                                            <span>
                                                <IconButton size="small" color="error" disabled={busy} onClick={() => void kill( p.pid )}>
                                                    <StopCircleIcon fontSize="small" />
                                                </IconButton>
                                            </span>
                                        </Tooltip>
                                    </Box>
                                </Box>
                            ) )}
                        </Box>
                    </Box>
                </Box>
            )}
        </Box>
    );
}

export default ProcessView;
