import { useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Chip from "@mui/material/Chip";
import Button from "@mui/material/Button";
import Tooltip from "@mui/material/Tooltip";
import IconButton from "@mui/material/IconButton";
import CircularProgress from "@mui/material/CircularProgress";
import CloudQueueIcon from "@mui/icons-material/CloudQueue";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import RefreshIcon from "@mui/icons-material/Refresh";
import TerminalIcon from "@mui/icons-material/Terminal";
import InsightsIcon from "@mui/icons-material/Insights";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import SettingsIcon from "@mui/icons-material/Settings";

import type { LocalStackState } from "../../shared/types";
import { api } from "../api";
import { metricsStore, useMetrics, type Breach, type MetricsSnapshot } from "../metricsStore";
import { SettingsDialog } from "./SettingsDialog";

export type AppView = "develop" | "monitor" | "repo" | "deploy";

//
// Top-level application header: product title, the Develop / Monitor tab switcher, and the shared
// LocalStack lifecycle controls (relevant to both tabs — Develop deploys to it, Monitor observes it).
//
export function AppHeader(
    { view, onView, localstack, onLocalStack } :
    { view : AppView; onView : ( v : AppView ) => void; localstack : LocalStackState; onLocalStack : ( s : LocalStackState ) => void }
)
{
    const [ busy, setBusy ] = useState<"up" | "down" | "status" | null>( null );
    const [ settingsOpen, setSettingsOpen ] = useState<boolean>( false );

    // live container metrics (recorded continuously by the singleton) → threshold alert + sound toggle
    const metrics : MetricsSnapshot = useMetrics();
    const breaches : Breach[] = metrics.breaches;
    const breachTitle : string = breaches.length > 0
        ? breaches.map( ( b : Breach ) => `${b.name} — ${b.metric} ${b.value.toFixed( 0 )}%` ).join( "\n" )
        : "";

    const color : "success" | "default" | "warning" = localstack.status === "running" ? "success" : localstack.status === "stopped" ? "default" : "warning";

    const run = async ( which : "up" | "down" | "status", fn : () => Promise<LocalStackState> ) : Promise<void> =>
    {
        setBusy( which );
        try { onLocalStack( await fn() ); }
        finally { setBusy( null ); }
    };

    return (
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, px: 2, height: 52, borderBottom: "1px solid", borderColor: "divider", bgcolor: "background.paper" }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, letterSpacing: 0.3, whiteSpace: "nowrap" }}>
                RumbleUp <Box component="span" sx={{ color: "primary.main" }}>Console</Box>
            </Typography>

            <Tabs value={view} onChange={( _e, v : AppView ) => onView( v )} sx={{ minHeight: 52, "& .MuiTab-root": { minHeight: 52 } }}>
                <Tab value="develop" icon={<TerminalIcon fontSize="small" />} iconPosition="start" label="Develop" />
                <Tab value="monitor" icon={<InsightsIcon fontSize="small" />} iconPosition="start" label="Monitor" />
                <Tab value="repo" icon={<AccountTreeIcon fontSize="small" />} iconPosition="start" label="Repo" />
                <Tab value="deploy" icon={<RocketLaunchIcon fontSize="small" />} iconPosition="start" label="Deploy" />
            </Tabs>

            <Box sx={{ flexGrow: 1 }} />

            {breaches.length > 0 && (
                <Tooltip title={breachTitle}>
                    <Chip color="error" icon={<WarningAmberIcon />} label={`${breaches.length} over ${metrics.threshold}%`} />
                </Tooltip>
            )}
            <Tooltip title={metrics.soundEnabled ? "Mute resource alerts" : "Unmute resource alerts"}>
                <IconButton size="small" onClick={() => metricsStore.toggleSound()} color={metrics.soundEnabled ? "default" : "warning"}>
                    {metrics.soundEnabled ? <VolumeUpIcon fontSize="small" /> : <VolumeOffIcon fontSize="small" />}
                </IconButton>
            </Tooltip>

            <Tooltip title={localstack.detail ?? "LocalStack — the local cloud both tabs target"}>
                <Chip icon={<CloudQueueIcon />} color={color} variant={localstack.status === "running" ? "filled" : "outlined"} label={`LocalStack: ${localstack.status}`} />
            </Tooltip>
            <Button startIcon={busy === "up" ? <CircularProgress size={14} /> : <PlayArrowIcon />} disabled={busy !== null || localstack.status === "running"} onClick={() => run( "up", api.localstackUp )}>Up</Button>
            <Button color="warning" startIcon={busy === "down" ? <CircularProgress size={14} /> : <StopIcon />} disabled={busy !== null || localstack.status !== "running"} onClick={() => run( "down", api.localstackDown )}>Down</Button>
            <Tooltip title="Refresh LocalStack status">
                <Button variant="outlined" sx={{ minWidth: 0, px: 1 }} disabled={busy !== null} onClick={() => run( "status", api.localstackStatus )}>
                    {busy === "status" ? <CircularProgress size={14} /> : <RefreshIcon fontSize="small" />}
                </Button>
            </Tooltip>

            <Tooltip title="Settings">
                <IconButton size="small" onClick={() => setSettingsOpen( true )}><SettingsIcon fontSize="small" /></IconButton>
            </Tooltip>
            <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen( false )} />
        </Box>
    );
}
