import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import ClearAllIcon from "@mui/icons-material/ClearAll";
import VerticalAlignBottomIcon from "@mui/icons-material/VerticalAlignBottom";
import SearchIcon from "@mui/icons-material/Search";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import OpenInBrowserOutlinedIcon from "@mui/icons-material/OpenInBrowserOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import StopIcon from "@mui/icons-material/Stop";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";

import { BROWSER_ID, WEBPROXY_ID, LOG_STREAMS, type BrowserState, type ClaudeMode, type LogLine, type LogStream, type ProcState, type ServiceRole, type StageId, type StageState, type StageStatus } from "../../shared/types";
import { api } from "../api";
import { MONO } from "../theme";
import { loadBuildSettings, BUILD_SETTINGS_EVENT } from "../buildSettings";
import { ClaudePanel } from "./ClaudePanel";
import { JobsPanel } from "./JobsPanel";
import { ApiPanel } from "./ApiPanel";
import { ConfigPanel } from "./ConfigPanel";
import { SecretsPanel } from "./SecretsPanel";
import { DynamoPanel } from "./DynamoPanel";
import { S3MediaPanel } from "./S3MediaPanel";
import { CognitoPanel } from "./CognitoPanel";
import { AuditPanel } from "./auditPanel/AuditPanel";
import { ProxyPanel, loadRouting } from "./ProxyPanel";
import { LogView, LEVELS, LogRow, parseLine, recLevelColor, ANSI } from "./LogView";

//
// The console pane. Tabs: one per log stream (Build / Docker / Deploy / Runtime), plus Claude (the
// in-app agent) and Jobs (Lambdas). Log tabs get a substring filter, autoscroll, clear, and the
// on-disk path. The Runtime tab adds a role filter (e.g. app-main / app-public) since a compose
// deploy multiplexes every container's logs into one stream.
//

type TabValue = LogStream | "web" | "proxy" | "api" | "config" | "secrets" | "data" | "cognito" | "storage" | "audit" | "claude" | "jobs";

const STREAM_LABEL : Record<LogStream, string> = { build: "Build", image: "Docker", deploy: "Deploy", runtime: "Log" };

const MAX_RENDER = 2500;

/** Type guard: is this tab one of the log-stream tabs (vs a panel tab like web/api/claude)? */
function isLogStream( v : TabValue ) : v is LogStream
{
    return ( LOG_STREAMS as Array<string> ).includes( v );
}

/** Per-stage status dot color on the Build/Docker/Deploy tabs: idle grey · running amber · success green · failed red. */
function stageDotColor( status : StageStatus | undefined ) : string | null
{
    switch ( status )
    {
        case "success": return "#3fb950";   // built
        case "failed":  return "#f85149";   // build failed
        case "running": return "#e3b341";   // building (yellow — readable on the dark bg)
        case "idle":    return "#6e7681";
        case "skipped": return "#484f58";
        default:        return null;
    }
}

/** The console pane for one service: per-stream log tabs (with filters/autoscroll) plus Web/Proxy/API/Config/Data/Cognito/Claude/Jobs panels. */
export function ConsoleView(
    { service, roles, stages, runningStreams, claudeMode, onClaudeMode, isFrontend } :
    {
        service : string;
        roles : Array<ServiceRole>;
        stages : StageState;
        runningStreams : Set<LogStream>;
        claudeMode : ClaudeMode;
        onClaudeMode : ( m : ClaudeMode ) => void;
        isFrontend : boolean;
    }
)
{
    // a frontend (SPA) has no Docker image, no compose runtime, and serves no API endpoints — drop those tabs
    const [ settingsTick, setSettingsTick ] = useState<number>( 0 );   // re-read target on an Auto/target change
    // hide stream tabs that don't apply: a frontend has no image/runtime; in Local mode Docker + Deploy
    // aren't part of the flow (build → run locally), so drop those too.
    const visibleStreams : Array<LogStream> = useMemo<Array<LogStream>>( () =>
    {
        const local : boolean = loadBuildSettings( service ).target === "local";
        let streams : Array<LogStream> = [ ...LOG_STREAMS ];
        if ( isFrontend ) streams = streams.filter( ( streamId ) => streamId !== "image" && streamId !== "runtime" );
        if ( local )      streams = streams.filter( ( streamId ) => streamId !== "image" && streamId !== "deploy" );
        return streams;
    }, [ isFrontend, service, settingsTick ] );
    const [ tab, setTab ]         = useState<TabValue>( isFrontend ? "web" : "build" );
    const [ lines, setLines ]     = useState<Array<LogLine>>( [] );
    const [ filter, setFilter ]   = useState<string>( "" );
    const [ autoscroll, setAuto ] = useState<boolean>( true );
    const [ logFile, setLogFile ] = useState<string>( "" );
    const [ roleFilter, setRoleFilter ] = useState<Array<string>>( [] );   // empty = all roles (runtime tab)
    const [ levelFilter, setLevelFilter ] = useState<Array<string>>( [] ); // empty = all levels
    const [ proxyRunning, setProxyRunning ] = useState<boolean>( false );   // for the Proxy tab status dot

    const endRef = useRef<HTMLDivElement | null>( null );

    // proxy run state → the Proxy tab's status dot (green running / red stopped)
    useEffect( () =>
    {
        if ( !isFrontend ) return;
        void api.proxyState().then( setProxyRunning );
        const off : () => void = api.onProc( ( p : ProcState ) => { if ( p.service === WEBPROXY_ID && p.stream === "runtime" ) setProxyRunning( p.running ); } );
        return off;
    }, [ isFrontend ] );

    // re-read the target when Auto/target settings change (so the Docker/Deploy tabs appear/disappear)
    useEffect( () =>
    {
        const on = () : void => setSettingsTick( ( t ) => t + 1 );
        window.addEventListener( BUILD_SETTINGS_EVENT, on );
        return () => window.removeEventListener( BUILD_SETTINGS_EVENT, on );
    }, [] );

    // if the active tab just got hidden (e.g. switched to Local while on Deploy), fall back to a visible one
    useEffect( () =>
    {
        if ( isLogStream( tab ) && !visibleStreams.includes( tab ) ) setTab( isFrontend ? "web" : "build" );
        if ( tab === "cognito" && service !== "auth" ) setTab( isFrontend ? "web" : "build" );   // Cognito tab is auth-only
        if ( tab === "storage" && service !== "media" ) setTab( isFrontend ? "web" : "build" );  // Storage tab is media-only
    }, [ visibleStreams, tab, isFrontend, service ] );

    const stream : LogStream | null = isLogStream( tab ) ? tab : null;

    // Drive the Trace (runtime) stream from the current target while the tab is active:
    //   • LocalStack → tail the deployed ECS containers' logs (no local process exists).
    //   • Local      → the local process's own logs (it streams there when you Run it).
    // On a target SWITCH, flush the stale logs + stop the local process so Trace shows only the new source.
    const prevTarget = useRef<string>( loadBuildSettings( service ).target );
    useEffect( () =>
    {
        if ( stream !== "runtime" ) return;
        const target : string = loadBuildSettings( service ).target;
        const switched : boolean = target !== prevTarget.current;
        prevTarget.current = target;

        if ( switched )   // Local ⇄ LocalStack: flush Trace + stop the local process that was feeding it
        {
            void api.devStop( service );
            void api.clearLog( service, "runtime" ).then( () => setLines( [] ) );
        }
        if ( target === "localstack" )
        {
            void api.tailDeployedStart( service );
            return () => { void api.tailDeployedStop( service ); };
        }
        return undefined;
    }, [ stream, service, settingsTick ] );

    // load history + subscribe for log streams
    useEffect( () =>
    {
        if ( !stream ) return;
        let active : boolean = true;
        void api.getLog( service, stream ).then( ( hist : Array<LogLine> ) => { if ( active ) setLines( hist ); } );
        void api.logPath( service, stream ).then( ( p : string ) => { if ( active ) setLogFile( p ); } );

        const off : () => void = api.onLog( ( line : LogLine ) =>
        {
            if ( line.service === service && line.stream === stream )
                setLines( ( prev ) => ( prev.length > MAX_RENDER ? [ ...prev.slice( -MAX_RENDER ), line ] : [ ...prev, line ] ) );
        } );

        return () => { active = false; off(); };
    }, [ service, stream ] );

    // Match a runtime line to a role. Two log shapes: docker compose prefixes lines with "<service>-<role>"
    // (LocalStack/compose), while a LOCAL run's Trace records carry name "<service>:<role>" (e.g. "app:main").
    /** Does a runtime line belong to one of the selected roles (compose prefix OR local Trace name)? */
    const roleMatches = ( line : LogLine ) : boolean =>
    {
        if ( roleFilter.length === 0 ) return true;
        const text : string = line.text.replace( ANSI, "" ).trimStart();
        const name : string = parseLine( line ).record?.name ?? "";   // e.g. "app:main"
        return roleFilter.some( ( role : string ) =>
            text.startsWith( `${service}-${role}` )                                          // compose prefix
            || name === `${service}:${role}` || name.startsWith( `${service}:${role}:` ) );  // local Trace name
    };

    // any structured (Trace JSON) lines present? → show the level filter (parsed once, cached)
    const hasRecords : boolean = useMemo<boolean>( () => lines.some( ( line ) => parseLine( line ).record !== undefined ), [ lines ] );

    const shown : Array<LogLine> = useMemo<Array<LogLine>>( () =>
    {
        let out : Array<LogLine> = lines;
        // runtime role filter: keep system lines plus lines matching a selected role
        if ( stream === "runtime" && roleFilter.length > 0 )
            out = out.filter( ( line ) => line.level === "sys" || roleMatches( line ) );
        // level filter applies only to structured records; raw lines always pass
        if ( levelFilter.length > 0 )
            out = out.filter( ( line ) => { const record = parseLine( line ).record; return !record || levelFilter.includes( record.level.toUpperCase() ); } );
        if ( filter )
            out = out.filter( ( line ) => line.text.toLowerCase().includes( filter.toLowerCase() ) );
        return out;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ lines, filter, roleFilter, levelFilter, stream ] );

    useLayoutEffect( () => { if ( autoscroll && stream ) endRef.current?.scrollIntoView( { block: "end" } ); }, [ shown, autoscroll, stream ] );

    /** Clear the current stream's in-memory view (the on-disk log file is kept). */
    const clear = () : void => { if ( stream ) void api.clearLog( service, stream ).then( () => setLines( [] ) ); };

    return (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
            {/* tab strip + (log) toolbar */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1, borderBottom: "1px solid", borderColor: "divider" }}>
                <Tabs
                    value={tab}
                    onChange={( _e, v : TabValue ) => setTab( v )}
                    variant="scrollable"
                    sx={{ minHeight: 40, "& .MuiTab-root": { minHeight: 40, minWidth: 0, px: 1.5 } }}
                >
                    {isFrontend && <Tab value="web" label="Web" sx={{ color: "primary.main" }} />}
                    {isFrontend && <Tab value="proxy" label={
                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.7 }}>
                            Proxy
                            <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: proxyRunning ? "#3fb950" : "#f85149" }} />
                        </Box>
                    } />}
                    {visibleStreams.map( ( streamId ) =>
                    {
                        // build/image/deploy get the STAGE status dot; runtime is green when the process is up
                        const dot : string | null = streamId === "runtime"
                            ? ( runningStreams.has( streamId ) ? "#3fb950" : null )
                            : stageDotColor( stages[ streamId as StageId ] );
                        return (
                            <Tab
                                key={streamId}
                                value={streamId}
                                label={
                                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.7 }}>
                                        {STREAM_LABEL[ streamId ]}
                                        {dot && <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: dot }} />}
                                    </Box>
                                }
                            />
                        );
                    } )}
                    {!isFrontend && <Tab value="api" label="API" />}
                    {!isFrontend && <Tab value="config" label="Config" />}
                    {!isFrontend && <Tab value="secrets" label="Secrets" />}
                    {!isFrontend && <Tab value="data" label="Data" />}
                    {!isFrontend && service === "auth" && <Tab value="cognito" label="Cognito" />}
                    {!isFrontend && service === "media" && <Tab value="storage" label="Storage" />}
                    {!isFrontend && service === "audit" && <Tab value="audit" label="Audit" />}
                    <Tab value="claude" label="Claude" sx={{ color: "secondary.main" }} />
                    {!isFrontend && <Tab value="jobs" label="Jobs" />}
                </Tabs>

                <Box sx={{ flexGrow: 1 }} />

                {stream && (
                    <>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1, bgcolor: "background.default", borderRadius: 1.5, border: "1px solid", borderColor: "divider" }}>
                            <SearchIcon fontSize="small" sx={{ color: "text.disabled" }} />
                            <InputBase placeholder="filter…" value={filter} onChange={( e ) => setFilter( e.target.value )} sx={{ fontSize: 12, width: 130, fontFamily: MONO }} />
                        </Box>
                        <Tooltip title="Autoscroll to newest">
                            <ToggleButton value="auto" size="small" selected={autoscroll} onChange={() => setAuto( ( v ) => !v )} sx={{ p: 0.6 }}>
                                <VerticalAlignBottomIcon fontSize="small" />
                            </ToggleButton>
                        </Tooltip>
                        <Tooltip title="Clear view (file on disk is kept)">
                            <IconButton size="small" onClick={clear}><ClearAllIcon fontSize="small" /></IconButton>
                        </Tooltip>
                    </>
                )}
            </Box>

            {/* filters: role (runtime, multi-container) + level (when structured records present) */}
            {stream && ( ( stream === "runtime" && roles.length > 1 ) || hasRecords ) && (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 1, py: 0.6, borderBottom: "1px solid", borderColor: "divider", bgcolor: "background.paper", flexWrap: "wrap" }}>
                    {stream === "runtime" && roles.length > 1 && (
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                            <Typography variant="caption" sx={{ color: "text.disabled" }}>show</Typography>
                            <ToggleButtonGroup size="small" value={roleFilter} onChange={( _e, next : Array<string> ) => setRoleFilter( next )}>
                                {roles.map( ( role ) => (
                                    <ToggleButton key={role.role} value={role.role} sx={{ px: 1.25, py: 0.2, fontFamily: MONO, fontSize: 11 }}>
                                        {service}-{role.role}
                                    </ToggleButton>
                                ) )}
                            </ToggleButtonGroup>
                        </Box>
                    )}
                    {hasRecords && (
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                            <Typography variant="caption" sx={{ color: "text.disabled" }}>level</Typography>
                            <ToggleButtonGroup size="small" value={levelFilter} onChange={( _e, next : Array<string> ) => setLevelFilter( next )}>
                                {LEVELS.map( ( level ) => (
                                    <ToggleButton key={level} value={level} sx={{ px: 1.25, py: 0.2, fontFamily: MONO, fontSize: 11, color: recLevelColor( level ), "&.Mui-selected": { color: recLevelColor( level ), fontWeight: 700 } }}>
                                        {level}
                                    </ToggleButton>
                                ) )}
                            </ToggleButtonGroup>
                        </Box>
                    )}
                </Box>
            )}

            {/* body */}
            {tab === "web"
                ? <Box sx={{ flexGrow: 1, minHeight: 0 }}><RunPanel claudeMode={claudeMode} onClaudeMode={onClaudeMode} /></Box>
                : tab === "proxy"
                ? <Box sx={{ flexGrow: 1, minHeight: 0 }}><ProxyPanel /></Box>
                : tab === "api"
                ? <Box sx={{ flexGrow: 1, minHeight: 0 }}><ApiPanel service={service} roles={roles} /></Box>
                : tab === "config"
                ? <Box sx={{ flexGrow: 1, minHeight: 0 }}><ConfigPanel service={service} /></Box>
                : tab === "secrets"
                ? <Box sx={{ flexGrow: 1, minHeight: 0 }}><SecretsPanel service={service} /></Box>
                : tab === "data"
                ? <Box sx={{ flexGrow: 1, minHeight: 0 }}><DynamoPanel service={service} /></Box>
                : tab === "cognito"
                ? <Box sx={{ flexGrow: 1, minHeight: 0 }}><CognitoPanel service={service} /></Box>
                : tab === "storage"
                ? <Box sx={{ flexGrow: 1, minHeight: 0 }}><S3MediaPanel service={service} /></Box>
                : tab === "audit"
                ? <Box sx={{ flexGrow: 1, minHeight: 0 }}><AuditPanel service={service} roles={roles} /></Box>
                : tab === "claude"
                ? <Box sx={{ flexGrow: 1, minHeight: 0 }}><ClaudePanel service={service} mode={claudeMode} onMode={onClaudeMode} /></Box>
                : tab === "jobs"
                    ? <Box sx={{ flexGrow: 1, minHeight: 0 }}><JobsPanel service={service} /></Box>
                    : (
                        <>
                            <Box
                                sx={{
                                    flexGrow: 1, minHeight: 0, overflow: "auto", bgcolor: "#0a0d12",
                                    fontFamily: MONO, fontSize: 12, lineHeight: 1.5, p: 1,
                                    "&::-webkit-scrollbar": { width: 10 },
                                    "&::-webkit-scrollbar-thumb": { background: "#30363d", borderRadius: 5 }
                                }}
                            >
                                {shown.length === 0
                                    ? <Typography variant="caption" sx={{ color: "text.disabled", fontFamily: MONO }}>
                                          {filter || roleFilter.length > 0 || levelFilter.length > 0
                                              ? "no lines match the filter"
                                              : stream === "runtime"
                                                  ? ( loadBuildSettings( service ).target === "localstack"
                                                          ? "tailing the deployed container — no logs yet (is it deployed & running?)"
                                                          : "Local mode — Run the service to see its Trace output" )
                                                  : "no output yet — run a stage"}
                                      </Typography>
                                    : shown.map( ( line ) => <LogRow key={`${line.stream}-${line.seq}`} line={line} /> )}
                                <div ref={endRef} />
                            </Box>

                            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1, py: 0.4, borderTop: "1px solid", borderColor: "divider", bgcolor: "background.paper" }}>
                                <Typography variant="caption" noWrap sx={{ color: "text.disabled", fontFamily: MONO, flexGrow: 1 }}>{logFile}</Typography>
                                <Tooltip title="Copy log file path">
                                    <IconButton size="small" onClick={() => void navigator.clipboard.writeText( logFile )}>
                                        <ContentCopyIcon sx={{ fontSize: 14 }} />
                                    </IconButton>
                                </Tooltip>
                            </Box>
                        </>
                    )}
        </Box>
    );
}

// ── Web tab: vite dev server (fast loop) + deployed build with watch-sync ─────────────────────────
// Device viewport presets for the app window (a curated selection — not exhaustive).
const DEVICES : { name : string; w : number; h : number }[] =
[
    { name: "Desktop",            w: 1200, h: 860 },
    { name: "iPhone SE",          w: 375,  h: 667 },
    { name: "iPhone 15",          w: 393,  h: 852 },
    { name: "iPhone 15 Pro Max",  w: 430,  h: 932 },
    { name: "Pixel 8",            w: 412,  h: 915 },
    { name: "Galaxy S20",         w: 360,  h: 800 },
    { name: "iPad mini",          w: 768,  h: 1024 },
    { name: "iPad Pro 11\"",      w: 834,  h: 1194 },
];

//
// Run — open the app in its OWN resizable Chromium window (owned by the console). The page's console
// (logs / warnings / errors) is captured natively and streamed into the Trace view below + a Claude
// panel, so a frontend bug can be handed straight to Claude. Defaults to the proxy edge URL.
//
function RunPanel( { claudeMode, onClaudeMode } : { claudeMode : ClaudeMode; onClaudeMode : ( m : ClaudeMode ) => void } )
{
    const [ url, setUrl ]     = useState<string>( `http://localhost:${loadRouting().port}` );
    const [ nav, setNav ]     = useState<BrowserState>( { open: false, url: "", canBack: false, canForward: false } );
    const [ lines, setLines ] = useState<Array<LogLine>>( [] );
    const [ showNet, setShowNet ]   = useState<boolean>( true );   // network (name:"net") records
    const [ showLog, setShowLog ]   = useState<boolean>( true );   // console + everything else
    const [ device, setDevice ]     = useState<string>( "Desktop" );

    useEffect( () =>
    {
        let active : boolean = true;
        // mirror navigation state into the URL bar; track the latest URL the app navigated to
        const apply = ( state : BrowserState ) : void => { setNav( state ); if ( state.url ) setUrl( state.url ); };
        void api.browserState().then( ( state : BrowserState ) => { if ( active ) apply( state ); } );
        void api.getLog( BROWSER_ID, "runtime" ).then( ( history : Array<LogLine> ) => { if ( active ) setLines( history ); } );
        const offBrowser : () => void = api.onBrowser( ( state : BrowserState ) => apply( state ) );
        const offLog : () => void = api.onLog( ( line : LogLine ) => { if ( line.service === BROWSER_ID && line.stream === "runtime" ) setLines( ( prev ) => ( prev.length > 1500 ? [ ...prev.slice( -1500 ), line ] : [ ...prev, line ] ) ); } );
        return () => { active = false; offBrowser(); offLog(); };
    }, [] );

    /** Clear the captured browser console/network view. */
    const clearLog = () : void => { void api.clearLog( BROWSER_ID, "runtime" ).then( () => setLines( [] ) ); };
    const open : boolean = nav.open;

    // #2 — split network (name:"net") vs console/other, toggle each
    const shown : Array<LogLine> = useMemo( () => lines.filter( ( line ) =>
    {
        const isNet : boolean = parseLine( line ).record?.name === "net";
        return isNet ? showNet : showLog;
    } ), [ lines, showNet, showLog ] );

    return (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider", flexWrap: "wrap" }}>
                <Tooltip title="Back"><span><IconButton size="small" disabled={!nav.canBack} onClick={() => void api.browserBack()}><ArrowBackIcon fontSize="small" /></IconButton></span></Tooltip>
                <Tooltip title="Forward"><span><IconButton size="small" disabled={!nav.canForward} onClick={() => void api.browserForward()}><ArrowForwardIcon fontSize="small" /></IconButton></span></Tooltip>
                <Tooltip title="Hard refresh (reload ignoring cache)"><span><IconButton size="small" disabled={!open} onClick={() => void api.browserReload()}><RefreshIcon fontSize="small" /></IconButton></span></Tooltip>
                <InputBase value={url} onChange={( e ) => setUrl( e.target.value )} onKeyDown={( e ) => { if ( e.key === "Enter" ) void api.browserOpen( url ); }}
                           sx={{ flexGrow: 1, minWidth: 220, fontFamily: MONO, fontSize: 13, px: 1, py: 0.25, border: "1px solid", borderColor: "divider", borderRadius: 1 }} />
                <Tooltip title={open ? "Reopen / navigate the app window" : "Open the app in its own window"}>
                    <IconButton size="small" color="success" onClick={() => void api.browserOpen( url )}><OpenInNewIcon fontSize="small" /></IconButton>
                </Tooltip>
                <Tooltip title="Close the app window"><span><IconButton size="small" color="error" disabled={!open} onClick={() => void api.browserClose()}><StopIcon fontSize="small" /></IconButton></span></Tooltip>
                <Tooltip title="Open in your system browser (no console capture there)">
                    <IconButton size="small" onClick={() => void api.openExternal( url )}><OpenInBrowserOutlinedIcon fontSize="small" /></IconButton>
                </Tooltip>
                <Select size="small" value={device} disabled={!open}
                        onChange={( e ) => { const name = e.target.value; setDevice( name ); const preset = DEVICES.find( ( candidate ) => candidate.name === name ); if ( preset ) void api.browserResize( preset.w, preset.h ); }}
                        sx={{ minWidth: 130, fontSize: 12 }}>
                    {DEVICES.map( ( preset ) => <MenuItem key={preset.name} value={preset.name} sx={{ fontSize: 12 }}>{preset.name} <Box component="span" sx={{ color: "text.disabled", ml: 0.5, fontFamily: MONO }}>{preset.w}×{preset.h}</Box></MenuItem> )}
                </Select>
            </Box>
            {/* #2 filter — show/hide network vs console */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 0.5, borderBottom: "1px solid", borderColor: "divider" }}>
                <Typography variant="caption" sx={{ color: "text.disabled" }}>Its own resizable window; console + network stream below and to Claude.</Typography>
                <Box sx={{ flexGrow: 1 }} />
                <Typography variant="caption" sx={{ color: "text.disabled" }}>show</Typography>
                <ToggleButtonGroup size="small" value={[ ...( showNet ? [ "net" ] : [] ), ...( showLog ? [ "log" ] : [] ) ]}
                    onChange={( _e, v : Array<string> ) => { setShowNet( v.includes( "net" ) ); setShowLog( v.includes( "log" ) ); }}>
                    <ToggleButton value="log" sx={{ px: 1.25, py: 0.1, fontSize: 11 }}>console</ToggleButton>
                    <ToggleButton value="net" sx={{ px: 1.25, py: 0.1, fontSize: 11 }}>network</ToggleButton>
                </ToggleButtonGroup>
            </Box>
            <Box sx={{ flexGrow: 1, minHeight: 0 }}>
                <LogView lines={shown} empty="open the app — its console + network appear here" hideId onClear={clearLog} />
            </Box>
            <Box sx={{ height: "40%", minHeight: 200, flexShrink: 0, borderTop: "1px solid", borderColor: "divider" }}>
                <ClaudePanel service={BROWSER_ID} mode={claudeMode} onMode={onClaudeMode} />
            </Box>
        </Box>
    );
}

