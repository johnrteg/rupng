import { useCallback, useEffect, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import Tooltip from "@mui/material/Tooltip";
import Chip from "@mui/material/Chip";
import HealthAndSafetyIcon from "@mui/icons-material/HealthAndSafety";
import FindReplaceIcon from "@mui/icons-material/FindReplace";
import RouterIcon from "@mui/icons-material/Router";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";

import {
    WEBPROXY_ID,
    type ClaudeMode, type DeployTarget, type HealthResult, type LogStream, type ProcState, type ServiceInfo, type StageId, type StageState
} from "../../shared/types";
import { api } from "../api";
import { ServiceBar } from "./ServiceBar";
import { ServicePanel } from "./ServicePanel";
import type { DotState } from "./StatusDot";

const EMPTY_STAGES : StageState = { build: "idle", image: "idle", deploy: "idle" };

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
    const [ busy, setBusy ]               = useState<Set<string>>( new Set() );
    const [ health, setHealth ]           = useState<Record<string, HealthResult[]>>( {} );
    const [ claudeMode, setClaudeMode ]   = useState<ClaudeMode>( "ondemand" );

    useEffect( () =>
    {
        void ( async () =>
        {
            const list : ServiceInfo[] = await api.listServices();
            setServices( list );
            setStageStates( await api.getStageStates() );
            setClaudeMode( await api.claudeGetMode() );
            setRunning( foldProcs( {}, await api.getProcStates() ) );
            const first : ServiceInfo | undefined = list.find( ( s ) => s.capabilities.scaffolded ) ?? list[ 0 ];
            if ( first ) setSelected( first.id );
        } )();
    }, [] );

    useEffect( () =>
    {
        const offProc  = api.onProc( ( p : ProcState ) => setRunning( ( prev ) => foldProcs( prev, [ p ] ) ) );
        const offStage = api.onStage( ( { service, state } ) => setStageStates( ( prev ) => ( { ...prev, [ service ]: state } ) ) );
        return () => { offProc(); offStage(); };
    }, [] );

    const statusOf = useCallback( ( id : string ) : DotState =>
    {
        const svc : ServiceInfo | undefined = services.find( ( s ) => s.id === id );
        if ( !svc?.capabilities.scaffolded ) return "planned";

        const streams : Set<LogStream> | undefined = running[ id ];
        const stage   : StageState = stageStates[ id ] ?? EMPTY_STAGES;

        if ( streams && ( streams.has( "build" ) || streams.has( "image" ) || streams.has( "deploy" ) ) ) return "busy";

        const healthy : boolean = ( health[ id ] ?? [] ).some( ( r ) => r.ok );
        if ( healthy || streams?.has( "runtime" ) ) return "running";

        if ( [ "build", "image", "deploy" ].some( ( k ) => stage[ k as StageId ] === "failed" ) ) return "error";
        return "stopped";
    }, [ services, running, stageStates, health ] );

    const current : ServiceInfo | null = useMemo<ServiceInfo | null>( () => services.find( ( s ) => s.id === selected ) ?? null, [ services, selected ] );

    // the local-edge dev proxy (serves the built SPA + proxies API/WS to services) — a global control
    const proxyRunning : boolean = running[ WEBPROXY_ID ]?.has( "runtime" ) ?? false;

    const onRun = useCallback( async ( id : string, stages : StageId[], target : DeployTarget, resume : boolean ) : Promise<void> =>
    {
        setBusy( ( prev ) => new Set( prev ).add( id ) );
        try { await api.runPipeline( { service: id, stages, target, resume } ); }
        finally { setBusy( ( prev ) => { const n = new Set( prev ); n.delete( id ); return n; } ); }
    }, [] );

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
        const list : ServiceInfo[] = await api.rescanServices();
        setServices( list );
        setSelected( ( cur ) => cur && list.some( ( s ) => s.id === cur ) ? cur
            : ( list.find( ( s ) => s.capabilities.scaffolded ) ?? list[ 0 ] )?.id ?? null );
    }, [] );

    return (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
            {/* thin toolbar */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 0.75, borderBottom: "1px solid", borderColor: "divider" }}>
                <Typography variant="caption" sx={{ color: "text.disabled" }}>{services.length} services</Typography>
                <Box sx={{ flexGrow: 1 }} />

                {/* local edge: the webproxy (serves the SPA + proxies API/WS to services, bypassing the gateway) */}
                <Chip size="small" icon={<RouterIcon />} variant="outlined" color={proxyRunning ? "success" : "default"}
                      label={proxyRunning ? "edge :8080" : "edge off"} />
                {proxyRunning
                    ? <>
                        <Tooltip title="Open the local edge (webproxy) — serves the SPA + proxies APIs">
                            <Button size="small" variant="outlined" startIcon={<OpenInNewIcon />} onClick={() => void api.openExternal( "http://localhost:8080" )}>:8080</Button>
                        </Tooltip>
                        <Button size="small" color="error" variant="outlined" startIcon={<StopIcon />} onClick={() => void api.proxyStop()}>Stop edge</Button>
                      </>
                    : <Tooltip title="Run the webproxy locally — single HTTP origin that serves the SPA and proxies API/WS to services (no API Gateway/CloudFront)">
                        <Button size="small" color="success" variant="outlined" startIcon={<PlayArrowIcon />} onClick={() => void api.proxyStart()}>Start edge</Button>
                      </Tooltip>}

                <Tooltip title="Ping /health on every running service">
                    <Button size="small" variant="outlined" startIcon={<HealthAndSafetyIcon />} onClick={() => void pingAll()}>Ping all</Button>
                </Tooltip>
                <Tooltip title="Re-scan apps/core + Ports.ts for new services (no restart)">
                    <Button size="small" variant="outlined" startIcon={<FindReplaceIcon />} onClick={() => void rescan()}>Rescan</Button>
                </Tooltip>
            </Box>

            <ServiceBar services={services} selected={selected} statusOf={statusOf} onSelect={setSelected} />

            <Box sx={{ flexGrow: 1, minHeight: 0 }}>
                {current
                    ? <ServicePanel
                          key={current.id}
                          service={current}
                          stages={stageStates[ current.id ] ?? EMPTY_STAGES}
                          runningStreams={running[ current.id ] ?? new Set()}
                          busy={busy.has( current.id )}
                          health={health[ current.id ] ?? []}
                          claudeMode={claudeMode}
                          onClaudeMode={changeClaudeMode}
                          onRun={( s, t, r ) => void onRun( current.id, s, t, r )}
                          onStop={() => void api.stopService( current.id )}
                          onComposeDown={() => void api.composeDown( current.id )}
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
