import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Typography from "@mui/material/Typography";
import Tooltip from "@mui/material/Tooltip";
import IconButton from "@mui/material/IconButton";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import CircularProgress from "@mui/material/CircularProgress";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutline";
import StopIcon from "@mui/icons-material/Stop";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";

import { autoSteps, deployPrereqMet, type BuildSettings, type BuildTarget, type ServiceInfo, type StageId } from "../../shared/types";
import { api } from "../api";
import { loadBuildSettings, saveBuildSettings, BUILD_SETTINGS_EVENT } from "../buildSettings";

//
// The per-service run/build controls, driven by a TARGET (where the service runs):
//   • Local      — Build, then run it locally (npm run dev). Auto-Build rebuilds on change and the
//                  orchestrator (re)starts the local process. The Run/Deploy dot = it's running locally.
//   • LocalStack — Build → Docker image → Deploy (cdklocal). The Run/Deploy dot = it's deployed.
// Each Auto checkbox persists. The LocalStack chain CASCADES (Docker needs Build; Deploy needs Docker
// for backends / Build for frontends). "Run now" forces the current target's auto-on steps immediately.
//

// the LocalStack build→deploy chain (Local target only auto-builds, then the orchestrator runs it)
const STEPS : { step : StageId; key : keyof BuildSettings; label : string }[] =
[
    { step: "image",  key: "docker", label: "Docker" },
    { step: "deploy", key: "deploy", label: "Deploy" }
];

export function ActionToolbar(
    { service, busy, anyRunning, localRunning, onStop } :
    {
        service : ServiceInfo;
        busy : boolean;
        anyRunning : boolean;
        localRunning : boolean;   // a console-managed local dev process (runtime stream) is up
        onStop : () => void;
    }
)
{
    const caps : ServiceInfo[ "capabilities" ] = service.capabilities;
    const frontend : boolean = caps.isFrontend;

    const [ settings, setSettings ] = useState<BuildSettings>( () => loadBuildSettings( service.id ) );

    // reflect persisted settings on service change AND when changed elsewhere (e.g. the API tab's
    // target toggle writes the same setting + fires this event) — so the toggles never drift.
    useEffect( () =>
    {
        const reload = () : void => setSettings( loadBuildSettings( service.id ) );
        reload();
        window.addEventListener( BUILD_SETTINGS_EVENT, reload );
        return () => window.removeEventListener( BUILD_SETTINGS_EVENT, reload );
    }, [ service.id ] );

    // manifest drift: warn when CloudManifest.ts changed since the last LocalStack deploy (→ redeploy).
    // Re-checked after every build/deploy (a manifest edit triggers a build; a deploy clears the drift).
    const [ drifted, setDrifted ] = useState<boolean>( false );
    useEffect( () =>
    {
        let active : boolean = true;
        const check = () : void => { void api.manifestDrift( service.id ).then( ( d ) => { if ( active ) setDrifted( d.drifted ); } ); };
        check();
        const off = api.onBuildQueue( () => check() );
        return () => { active = false; off(); };
    }, [ service.id ] );

    const localStack : boolean = settings.target === "localstack";

    // LocalStack-chain steps that apply to this service (Docker only for backends that can image)
    const steps : typeof STEPS = STEPS.filter( ( d ) => d.step !== "image" || ( !frontend && caps.canImage ) );

    const enabled = ( step : StageId ) : boolean =>
        step === "image" ? settings.build
        : deployPrereqMet( settings, frontend ) && caps.canDeploy;   // deploy

    const disabledHint = ( step : StageId ) : string =>
        step === "deploy" && !caps.canDeploy ? "No cloud stack for this service — add src/CloudManifest.ts and register it in cloud/src/app.ts"
        : step === "image" && !settings.build ? "Enable Build first"
        : step === "deploy" && !deployPrereqMet( settings, frontend ) ? ( frontend ? "Enable Build first" : "Enable Build + Docker first" )
        : "";

    const update = ( patch : Partial<BuildSettings> ) : void =>
    {
        const next : BuildSettings = { ...settings, ...patch };
        setSettings( next );
        saveBuildSettings( service.id, next );   // persists + fires the event → DevelopView re-pushes config
    };

    const setTarget = ( t : BuildTarget ) : void => update( { target: t } );

    const canRunNow : boolean = autoSteps( settings, frontend, caps.canDeploy ).length > 0 && !busy;

    return (
        <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1.25 }}>
            {/* where this service runs */}
            <ToggleButtonGroup size="small" exclusive value={settings.target} onChange={( _e, v : BuildTarget | null ) => v && setTarget( v )}>
                <ToggleButton value="local" sx={{ px: 1.25, py: 0.2 }}>Local</ToggleButton>
                <ToggleButton value="localstack" sx={{ px: 1.25, py: 0.2 }}>LocalStack</ToggleButton>
            </ToggleButtonGroup>

            <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 700, ml: 0.5 }}>Auto:</Typography>

            {/* Build applies to both targets */}
            <FormControlLabel
                sx={{ mr: 0 }}
                control={<Checkbox size="small" checked={settings.build} onChange={( e ) => update( { build: e.target.checked } )} sx={{ p: 0.5 }} />}
                label={<Typography variant="caption">Build</Typography>}
            />

            {/* Docker + Deploy only when targeting LocalStack */}
            {localStack && steps.map( ( { step, key, label } ) =>
            {
                const on : boolean = enabled( step );
                const checked : boolean = settings[ key ] === true && on;
                const showPlay : boolean = on && !checked;
                const hint : string = disabledHint( step );
                const control = (
                    <FormControlLabel
                        sx={{ mr: 0.25 }}
                        control={<Checkbox size="small" checked={checked} disabled={!on} onChange={( e ) => update( { [ key ]: e.target.checked } )} sx={{ p: 0.5 }} />}
                        label={<Typography variant="caption" sx={{ color: on ? "text.primary" : "text.disabled" }}>{label}</Typography>}
                    />
                );
                return (
                    <Box key={step} sx={{ display: "flex", alignItems: "center" }}>
                        {hint ? <Tooltip title={hint}><span>{control}</span></Tooltip> : control}
                        {showPlay && (
                            <Tooltip title={`Run ${label} once now`}>
                                <span>
                                    <IconButton size="small" disabled={busy} onClick={() => void api.buildRunStep( service.id, step )} sx={{ p: 0.25 }}>
                                        <PlayArrowIcon sx={{ fontSize: 16 }} />
                                    </IconButton>
                                </span>
                            </Tooltip>
                        )}
                    </Box>
                );
            } )}

            <Tooltip title={localStack ? "Run the auto-on steps now (build → docker → deploy)" : "Build now (the local process auto-(re)starts on success)"}>
                <span>
                    <Button
                        size="small"
                        variant="contained"
                        color="success"
                        disabled={!canRunNow}
                        startIcon={busy ? <CircularProgress size={14} color="inherit" /> : <PlayCircleOutlineIcon />}
                        onClick={() => void api.buildRunNow( service.id )}
                        sx={{ ml: 0.5 }}
                    >
                        Run
                    </Button>
                </span>
            </Tooltip>

            {/* Local target: start the local process by hand (it also auto-(re)starts on build) */}
            {!localStack && !frontend && !localRunning && (
                <Tooltip title="Run this service locally now (npm run dev)">
                    <Button size="small" variant="outlined" startIcon={<PlayArrowIcon />} onClick={() => void api.devStart( service.id )}>
                        Run local
                    </Button>
                </Tooltip>
            )}

            <Button size="small" color="error" variant="outlined" startIcon={<StopIcon />} disabled={!anyRunning} onClick={onStop}>
                Stop
            </Button>

            {/* manifest changed since the last LocalStack deploy → its AWS footprint is stale (new
                resources won't resolve until redeployed). Offer a one-click redeploy. */}
            {drifted && (
                <Tooltip title="CloudManifest changed since the last LocalStack deploy — redeploy to create/apply its AWS resources (code changes don't need this; manifest/footprint changes do)">
                    <Button size="small" color="warning" variant="contained" startIcon={<WarningAmberIcon />} onClick={() => void api.buildRunStep( service.id, "deploy" )}>
                        Redeploy
                    </Button>
                </Tooltip>
            )}
        </Box>
    );
}
