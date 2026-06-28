import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import Divider from "@mui/material/Divider";

import type { ClaudeMode, HealthResult, LogStream, ServiceInfo, StageState } from "../../shared/types";
import { serviceIcon } from "../icons";
import { MONO } from "../theme";
import { ActionToolbar } from "./ActionToolbar";
import { ConsoleView } from "./ConsoleView";
import { HealthCard } from "./HealthCard";

//
// The main work area for the selected service: identity header, the pipeline toolbar, the console
// (left, grows), and a right rail with health + Ask-Claude.
//
export function ServicePanel(
    { service, stages, runningStreams, busy, health, claudeMode, onClaudeMode, onStop, onHealth } :
    {
        service : ServiceInfo;
        stages : StageState;
        runningStreams : Set<LogStream>;
        busy : boolean;
        health : HealthResult[];
        claudeMode : ClaudeMode;
        onClaudeMode : ( m : ClaudeMode ) => void;
        onStop : () => void;
        onHealth : ( r : HealthResult[] ) => void;
    }
)
{
    const Icon       : ReturnType<typeof serviceIcon> = serviceIcon( service.icon );
    const anyRunning : boolean = runningStreams.size > 0;
    const hasFailure : boolean = stages.build === "failed" || stages.image === "failed" || stages.deploy === "failed";

    return (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
            {/* top bar: identity · pipeline actions · service variants (right) */}
            <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1.25, px: 2, py: 1 }}>
                <Icon sx={{ fontSize: 26, color: "primary.main" }} />
                <Typography variant="h6" sx={{ fontWeight: 700 }}>{service.label}</Typography>
                <Typography variant="caption" sx={{ color: "text.disabled", fontFamily: MONO }}>{service.id}</Typography>
                {service.version && (
                    <Tooltip title={`version · apps/core/${service.id}/package.json`}>
                        <Chip size="small" variant="outlined" color="primary" label={`v${service.version}`} sx={{ fontFamily: MONO }} />
                    </Tooltip>
                )}
                <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
                <ActionToolbar
                    service={service}
                    busy={busy}
                    anyRunning={anyRunning}
                    localRunning={runningStreams.has( "runtime" )}
                    onStop={onStop}
                />
                <Box sx={{ flexGrow: 1 }} />
                {!service.capabilities.scaffolded && <Chip label="planned" variant="outlined" />}
                {service.roles.filter( ( r ) => r.port > 0 ).map( ( r ) => (
                    <Chip key={r.role} variant="outlined" label={`${r.role} :${r.port}`} sx={{ fontFamily: MONO }} />
                ) )}
            </Box>

            {/* failure hint only (the service is obvious from the selected button — no blurb line) */}
            {hasFailure && (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 2, pb: 1 }}>
                    <Typography variant="caption" sx={{ color: "warning.main" }}>
                        a step failed — fix it, then ▶ the step (or "Run") to retry (the chain halts on a failure)
                    </Typography>
                </Box>
            )}
            <Divider />

            {/* console (left) + right rail (health). A frontend has no HTTP endpoints → no health rail. */}
            <Box sx={{ display: "flex", flexGrow: 1, minHeight: 0 }}>
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <ConsoleView
                        service={service.id}
                        roles={service.roles}
                        stages={stages}
                        runningStreams={runningStreams}
                        claudeMode={claudeMode}
                        onClaudeMode={onClaudeMode}
                        isFrontend={service.capabilities.isFrontend}
                    />
                </Box>
                {!service.capabilities.isFrontend && (
                    <Box
                        sx={{
                            width        : 330,
                            flexShrink   : 0,
                            borderLeft   : "1px solid",
                            borderColor  : "divider",
                            display      : "flex",
                            flexDirection: "column",
                            overflow     : "auto"
                        }}
                    >
                        <HealthCard service={service} results={health} onResults={onHealth} />
                    </Box>
                )}
            </Box>
        </Box>
    );
}
