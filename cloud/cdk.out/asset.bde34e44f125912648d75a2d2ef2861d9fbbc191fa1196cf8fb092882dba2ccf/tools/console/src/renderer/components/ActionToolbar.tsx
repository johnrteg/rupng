import { useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import ButtonGroup from "@mui/material/ButtonGroup";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import ReplayIcon from "@mui/icons-material/Replay";
import StopIcon from "@mui/icons-material/Stop";
import LayersClearIcon from "@mui/icons-material/LayersClear";

import {
    STAGE_ORDER,
    type DeployTarget, type ServiceInfo, type StageId, type StageState, type StageStatus
} from "../../shared/types";

//
// The per-service pipeline controls. Pick any subset of stages (Build → Docker image → Deploy); the
// run executes them in order and HALTS on first failure. "Resume" re-runs but skips stages that
// already succeeded (no rolling back to the start). Each stage shows its live status.
//

const STAGE_LABEL : Record<StageId, string> = { build: "Build", image: "Docker image", deploy: "Deploy" };

const STATUS_COLOR : Record<StageStatus, string> =
{
    idle    : "#6e7681",
    running : "#d29922",
    success : "#3fb950",
    failed  : "#f85149",
    skipped : "#484f58"
};

function StageBadge( { stage, status } : { stage : StageId; status : StageStatus } )
{
    return (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.6 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: STATUS_COLOR[ status ] }} />
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {STAGE_LABEL[ stage ]}: <Box component="span" sx={{ color: STATUS_COLOR[ status ], fontWeight: 600 }}>{status}</Box>
            </Typography>
        </Box>
    );
}

export function ActionToolbar(
    { service, stages, busy, anyRunning, onRun, onStop, onComposeDown } :
    {
        service : ServiceInfo;
        stages : StageState;
        busy : boolean;
        anyRunning : boolean;
        onRun : ( selected : StageId[], target : DeployTarget, resume : boolean ) => void;
        onStop : () => void;
        onComposeDown : () => void;
    }
)
{
    const caps : ServiceInfo[ "capabilities" ] = service.capabilities;

    // a stage is selectable only if the service can do it
    const canStage = ( s : StageId ) : boolean =>
        s === "build" ? caps.canBuild : s === "image" ? caps.canImage : ( caps.canCompose || caps.scaffolded );

    const defaultSelection : StageId[] = useMemo<StageId[]>( () => STAGE_ORDER.filter( canStage ), [ service.id ] );

    const [ selected, setSelected ] = useState<StageId[]>( defaultSelection );
    const [ target, setTarget ]     = useState<DeployTarget>( caps.canCompose ? "compose" : "cdklocal" );

    const deploySelected : boolean = selected.includes( "deploy" );
    const canRun         : boolean = selected.length > 0 && !busy;
    const hasFailure     : boolean = STAGE_ORDER.some( ( s ) => stages[ s ] === "failed" );

    return (
        <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1.25, px: 2, py: 1.25 }}>
            {/* stage selection */}
            <ToggleButtonGroup
                size="small"
                value={selected}
                onChange={( _e, next : StageId[] ) => setSelected( STAGE_ORDER.filter( ( s ) => next.includes( s ) ) )}
            >
                {STAGE_ORDER.map( ( s ) => (
                    <ToggleButton key={s} value={s} disabled={!canStage( s )} sx={{ px: 1.5 }}>
                        {STAGE_LABEL[ s ]}
                    </ToggleButton>
                ) )}
            </ToggleButtonGroup>

            {/* deploy target */}
            <Tooltip title={deploySelected ? "Local deploy mechanism" : "Select Deploy to choose a target"}>
                <Select
                    size="small"
                    value={target}
                    disabled={!deploySelected}
                    onChange={( e ) => setTarget( e.target.value as DeployTarget )}
                    sx={{ minWidth: 150 }}
                >
                    <MenuItem value="compose" disabled={!caps.canCompose}>docker compose</MenuItem>
                    <MenuItem value="cdklocal">cdklocal deploy</MenuItem>
                </Select>
            </Tooltip>

            {/* run / resume */}
            <ButtonGroup variant="contained" disabled={!canRun}>
                <Button
                    startIcon={busy ? <CircularProgress size={14} color="inherit" /> : <PlayArrowIcon />}
                    onClick={() => onRun( selected, target, false )}
                >
                    Run
                </Button>
                <Tooltip title="Re-run selected stages, skipping ones that already succeeded">
                    <Button color="secondary" startIcon={<ReplayIcon />} onClick={() => onRun( selected, target, true )}>
                        Resume
                    </Button>
                </Tooltip>
            </ButtonGroup>

            <Button color="error" variant="outlined" startIcon={<StopIcon />} disabled={!anyRunning} onClick={onStop}>
                Stop
            </Button>

            {caps.canCompose && (
                <Tooltip title="docker compose down — stop & remove this service's containers">
                    <Button variant="outlined" startIcon={<LayersClearIcon />} onClick={onComposeDown}>
                        Compose down
                    </Button>
                </Tooltip>
            )}

            <Box sx={{ flexGrow: 1 }} />

            {/* live stage status */}
            <Box sx={{ display: "flex", gap: 1.5, alignItems: "center" }}>
                {STAGE_ORDER.map( ( s ) => <StageBadge key={s} stage={s} status={stages[ s ]} /> )}
            </Box>

            {hasFailure && (
                <Typography variant="caption" sx={{ color: "warning.main", width: "100%", textAlign: "right" }}>
                    A stage failed — fix it, then "Resume" to continue from where it stopped (passed stages are skipped).
                </Typography>
            )}
        </Box>
    );
}
