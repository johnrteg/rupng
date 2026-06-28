import { useCallback, useEffect, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import Tooltip from "@mui/material/Tooltip";
import Chip from "@mui/material/Chip";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import HealthAndSafetyIcon from "@mui/icons-material/HealthAndSafety";
import FindReplaceIcon from "@mui/icons-material/FindReplace";
import BuildIcon from "@mui/icons-material/Build";
import RouterIcon from "@mui/icons-material/Router";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";

import LinearProgress from "@mui/material/LinearProgress";

import {
    WEBPROXY_ID,
    type BrowserState, type BuildQueue, type ClaudeMode, type HealthResult, type LogStream, type ProcState, type ServiceInfo, type StageId, type StageState
} from "../../shared/types";
import { api } from "../api";
import { allBuildSettings, loadBuildSettings, BUILD_SETTINGS_EVENT } from "../buildSettings";
import { ServiceBar } from "./ServiceBar";
import { ServicePanel } from "./ServicePanel";
import { loadRouting } from "./ProxyPanel";
import type { ServiceDot } from "./ServiceButton";
import type { DotState } from "./StatusDot";

const EMPTY_STAGES : StageState = { build: "idle", image: "idle", deploy: "idle" };

// persisted "build all + run the selected service on console launch" preference (off by default)
const BUILD_ALL_ON_LAUNCH = "rup.buildall.onlaunch";
const loadBuildAllOnLaunch = () : boolean => { try { return localStorage.getItem( BUILD_ALL_ON_LAUNCH ) === "1"; } catch { return false; } };
const saveBuildAllOnLaunch = ( on : boolean ) : void => { try { localStorage.setItem( BUILD_ALL_ON_LAUNCH, on ? "1" : "0" ); } catch { /* ignore */ } };

//
// The "Develop" tab — the full build/deploy workspace: the service bar, the per-service pipeline,
// console, health, Claude, and jobs. Owns all service/pipeline state + the live subscriptions.
//
export function DevelopView()
{
    const [ services, setServices ]       = useState<ServiceInfo[]>( [] );
    const [ selected, setSelected ]       = useState<string | null>( null );
    const [ stageStates, setStageStates ] = useState<Record<string, StageState>>( {} );
    const [ running, setRunning ]         = useState<Record<string, Set<LogStream>>>( {} );
    const [ health, setHealth ]           = useState<Record<string, HealthResult[]>>( {} );
    const [ claudeMode, setClaudeMode ]   = useState<ClaudeMode>( "ondemand" );
    const [ buildQueue, setBuildQueue ]   = useState<BuildQueue | null>( null );
    const [ browserOpen, setBrowserOpen ] = useState<boolean>( false );   // a local frontend "runs" in the app window
    const [ settingsTick, setSettingsTick ] = useState<number>( 0 );      // bump to recompute dots when a target/Auto toggle changes
    const [ buildAllLaunch, setBuildAllLaunch ] = useState<boolean>( loadBuildAllOnLaunch );   // build all + run selected on launch

    useEffect( () =>
    {
        void ( async () =>
        {
            const list : ServiceInfo[] = await api.listServices();
            setServices( list );
            setStageStates( await api.getStageStates() );
            setClaudeMode( await api.claudeGetMode() );
            setRunning( foldProcs( {}, await api.getProcStates() ) );
            setBuildQueue( await api.buildQueueGet() );
            setBrowserOpen( ( await api.browserState() ).open );
            // push the persisted Build settings to the orchestrator so it watches + auto-builds
            await api.buildConfigure( allBuildSettings( list.map( ( s ) => s.id ) ) );
            const first : ServiceInfo | undefined = list.find( ( s ) => s.capabilities.scaffolded ) ?? list[ 0 ];
            if ( first ) setSelected( first.id );
            // optional: build the whole fleet + run the selected one, once, on launch (safe sequential path)
            if ( loadBuildAllOnLaunch() )
            {
                const ids : string[] = list.filter( ( s ) => s.capabilities.scaffolded && s.capabilities.canBuild ).map( ( s ) => s.id );
                void api.buildAll( ids, first?.id );
            }
        } )();
    }, [] );

    useEffect( () =>
    {
        const offProc  = api.onProc( ( p : ProcState ) => setRunning( ( prev ) => foldProcs( prev, [ p ] ) ) );
        const offStage = api.onStage( ( { service, state } ) => setStageStates( ( prev ) => ( { ...prev, [ service ]: state } ) ) );
        const offQueue = api.onBuildQueue( ( q : BuildQueue ) => setBuildQueue( q ) );
        const offBrowser = api.onBrowser( ( s : BrowserState ) => setBrowserOpen( s.open ) );
        // re-push the build config + recompute dots whenever a target/Auto toggle changes (fired by saveBuildSettings)
        const onSettings = () : void => { void api.buildConfigure( allBuildSettings( services.map( ( s ) => s.id ) ) ); setSettingsTick( ( t ) => t + 1 ); };
        window.addEventListener( BUILD_SETTINGS_EVENT, onSettings );
        return () => { offProc(); offStage(); offQueue(); offBrowser(); window.removeEventListener( BUILD_SETTINGS_EVENT, onSettings ); };
    }, [ services ] );

    // Indicator dots, target-aware. Local: Build · Run (run = local process up, or app window open for web).
    // LocalStack: Build · Container · Deploy (run = deployed). Each: busy (yellow) → failed (red) →
    // done/running (green) → idle (grey).
    const statusOf = useCallback( ( id : string ) : ServiceDot[] =>
    {
        const svc : ServiceInfo | undefined = services.find( ( s ) => s.id === id );
        const frontend : boolean = svc?.capabilities.isFrontend ?? false;
        const local : boolean = loadBuildSettings( id ).target === "local";
        const showContainer : boolean = !local && !frontend && ( svc?.capabilities.canImage ?? false );
        const runLabel : string = local ? "Run" : "Deploy";
        const dot = ( key : string, label : string, state : DotState ) : ServiceDot => ( { key, label, state } );

        if ( !svc?.capabilities.scaffolded )
            return [ dot( "build", "Build", "planned" ),
                     ...( showContainer ? [ dot( "image", "Container", "planned" ) ] : [] ),
                     dot( "run", runLabel, "planned" ) ];

        const streams : Set<LogStream> | undefined = running[ id ];
        const stage   : StageState = stageStates[ id ] ?? EMPTY_STAGES;
        const healthy : boolean = ( health[ id ] ?? [] ).some( ( r ) => r.ok );

        const build : DotState =
            ( streams?.has( "build" ) || stage.build === "running" ) ? "busy"
            : stage.build === "failed" ? "error"
            : stage.build === "success" ? "running" : "stopped";

        const image : DotState =
            ( streams?.has( "image" ) || stage.image === "running" ) ? "busy"
            : stage.image === "failed" ? "error"
            : stage.image === "success" ? "running" : "stopped";

        // Run/Deploy dot: Local = is it actually running (process up, or app window open for web);
        // LocalStack = is it deployed (deploy stage success / healthy / a runtime follow is up).
        let run : DotState;
        if ( local )
            run = frontend ? ( browserOpen ? "running" : "stopped" )
                           : ( streams?.has( "runtime" ) ? "running" : "stopped" );
        else
            run = ( streams?.has( "deploy" ) || stage.deploy === "running" ) ? "busy"
                : stage.deploy === "failed" ? "error"
                : ( stage.deploy === "success" || healthy || streams?.has( "runtime" ) ) ? "running" : "stopped";

        return [ dot( "build", "Build", build ),
                 ...( showContainer ? [ dot( "image", "Container", image ) ] : [] ),
                 dot( "run", runLabel, run ) ];
    }, [ services, running, stageStates, health, browserOpen, settingsTick ] );

    const current : ServiceInfo | null = useMemo<ServiceInfo | null>( () => services.find( ( s ) => s.id === selected ) ?? null, [ services, selected ] );

    // the selected service is "busy" while it's the one building/deploying now (queue or a running stage)
    const currentBusy : boolean = current
        ? ( buildQueue?.current === current.id
            || ( [ "build", "image", "deploy" ] as StageId[] ).some( ( k ) => ( stageStates[ current.id ] ?? EMPTY_STAGES )[ k ] === "running" ) )
        : false;

    // the local-edge dev proxy (serves the built SPA + proxies API/WS to services) — a global control
    const proxyRunning : boolean = running[ WEBPROXY_ID ]?.has( "runtime" ) ?? false;
    const edgePort : number = loadRouting().port;   // persisted listen port (set in the Proxy tab)

    const setHealthFor = useCallback( ( id : string, r : HealthResult[] ) => setHealth( ( prev ) => ( { ...prev, [ id ]: r } ) ), [] );

    const changeClaudeMode = useCallback( ( m : ClaudeMode ) => { setClaudeMode( m ); void api.claudeSetMode( m ); }, [] );

    const pingAll = useCallback( async () : Promise<void> =>
    {
        const all : HealthResult[] = await api.pingAll();
        const byService : Record<string, HealthResult[]> = {};
        for ( const r of all ) ( byService[ r.service ] ??= [] ).push( r );
        setHealth( ( prev ) => ( { ...prev, ...byService } ) );
    }, [] );

    const rescan = useCallback( async () : Promise<void> =>
    {
        const list : ServiceInfo[] = await api.rescanServices();   // also rebuilds the orchestrator dep graph
        setServices( list );
        // re-push the build config so any newly-discovered services get watched/auto-built
        await api.buildConfigure( allBuildSettings( list.map( ( s ) => s.id ) ) );
        setSelected( ( cur ) => cur && list.some( ( s ) => s.id === cur ) ? cur
            : ( list.find( ( s ) => s.capabilities.scaffolded ) ?? list[ 0 ] )?.id ?? null );
    }, [] );

    // build every build-capable service (sequential queue → no races / no FD storm) and start ONLY the
    // selected one locally — building the fleet is safe (processes exit); running the fleet is not.
    const buildAll = useCallback( () : void =>
    {
        const ids : string[] = services.filter( ( s ) => s.capabilities.scaffolded && s.capabilities.canBuild ).map( ( s ) => s.id );
        void api.buildAll( ids, selected ?? undefined );
    }, [ services, selected ] );

    return (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
            {/* thin toolbar */}
            <Box sx={{ display: "flex", flexShrink: 0, alignItems: "center", gap: 1, px: 1.5, py: 0.75, borderBottom: "1px solid", borderColor: "divider" }}>
                <Typography variant="caption" sx={{ color: "text.disabled" }}>{services.length} services</Typography>
                <Box sx={{ flexGrow: 1 }} />

                {/* local edge: the webproxy (serves the SPA + proxies API/WS to services, bypassing the gateway) */}
                <Chip size="small" icon={<RouterIcon />} variant="outlined" color={proxyRunning ? "success" : "default"}
                      label={proxyRunning ? `edge :${edgePort}` : "edge off"} />
                {proxyRunning
                    ? <>
                        <Tooltip title="Open the local edge (webproxy) — serves the SPA + proxies APIs">
                            <Button size="small" variant="outlined" startIcon={<OpenInNewIcon />} onClick={() => void api.openExternal( `http://localhost:${edgePort}` )}>:{edgePort}</Button>
                        </Tooltip>
                        <Button size="small" color="error" variant="outlined" startIcon={<StopIcon />} onClick={() => void api.proxyStop()}>Stop Proxy</Button>
                      </>
                    : <Tooltip title="Run the webproxy locally — single HTTP origin that serves the SPA and proxies API/WS to services (no API Gateway/CloudFront)">
                        <Button size="small" color="success" variant="outlined" startIcon={<PlayArrowIcon />} onClick={() => void api.proxyStart( edgePort )}>Start Proxy</Button>
                      </Tooltip>}

                <Tooltip title={`Build every service in sequence (no fleet spawn), then run ${selected ?? "the selected service"} locally`}>
                    <Button size="small" variant="outlined" startIcon={<BuildIcon />} onClick={buildAll}>Build all</Button>
                </Tooltip>
                <Tooltip title="Run Build all + start the selected service automatically each time the console launches">
                    <FormControlLabel
                        sx={{ m: 0 }}
                        control={<Checkbox size="small" checked={buildAllLaunch} onChange={( e ) => { setBuildAllLaunch( e.target.checked ); saveBuildAllOnLaunch( e.target.checked ); }} sx={{ p: 0.5 }} />}
                        label={<Typography variant="caption" sx={{ color: "text.disabled" }}>on launch</Typography>}
                    />
                </Tooltip>
                <Tooltip title="Ping /health on every running service">
                    <Button size="small" variant="outlined" startIcon={<HealthAndSafetyIcon />} onClick={() => void pingAll()}>Ping all</Button>
                </Tooltip>
                <Tooltip title="Re-read services/ports from Ports.ts + the build dependency graph (new services, packages, or changed @repo deps) — no restart">
                    <Button size="small" variant="outlined" startIcon={<FindReplaceIcon />} onClick={() => void rescan()}>Rescan</Button>
                </Tooltip>
            </Box>

            <ServiceBar services={services} selected={selected} statusOf={statusOf} onSelect={setSelected} />

            {/* sequential build-queue progress (auto-build across services) */}
            {buildQueue && buildQueue.total > 0 && (
                <Box sx={{ flexShrink: 0, borderBottom: "1px solid", borderColor: "divider" }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 2, py: 0.4 }}>
                        <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 600 }}>
                            Building {buildQueue.current ?? "…"}
                        </Typography>
                        <Typography variant="caption" sx={{ color: "text.disabled" }}>
                            {buildQueue.done}/{buildQueue.total}{buildQueue.queue.length > 0 ? ` · queued: ${buildQueue.queue.join( ", " )}` : ""}
                        </Typography>
                    </Box>
                    <LinearProgress variant="determinate" value={buildQueue.total > 0 ? ( buildQueue.done / buildQueue.total ) * 100 : 0} sx={{ height: 3 }} />
                </Box>
            )}

            <Box sx={{ flexGrow: 1, minHeight: 0 }}>
                {current
                    ? <ServicePanel
                          key={current.id}
                          service={current}
                          stages={stageStates[ current.id ] ?? EMPTY_STAGES}
                          runningStreams={running[ current.id ] ?? new Set()}
                          busy={currentBusy}
                          health={health[ current.id ] ?? []}
                          claudeMode={claudeMode}
                          onClaudeMode={changeClaudeMode}
                          onStop={() => void api.stopService( current.id )}
                          onHealth={( r ) => setHealthFor( current.id, r )}
                      />
                    : <Box sx={{ display: "grid", placeItems: "center", height: "100%" }}>
                          <Typography color="text.disabled">Loading services…</Typography>
                      </Box>}
            </Box>
        </Box>
    );
}

function foldProcs( prev : Record<string, Set<LogStream>>, procs : ProcState[] ) : Record<string, Set<LogStream>>
{
    const next : Record<string, Set<LogStream>> = {};
    for ( const k of globalThis.Object.keys( prev ) ) next[ k ] = new Set( prev[ k ] );
    for ( const p of procs )
    {
        const set : Set<LogStream> = next[ p.service ] ?? ( next[ p.service ] = new Set() );
        if ( p.running ) set.add( p.stream ); else set.delete( p.stream );
    }
    return next;
}
