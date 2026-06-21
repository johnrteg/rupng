import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import CircularProgress from "@mui/material/CircularProgress";
import ClearAllIcon from "@mui/icons-material/ClearAll";
import VerticalAlignBottomIcon from "@mui/icons-material/VerticalAlignBottom";
import SearchIcon from "@mui/icons-material/Search";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import RefreshIcon from "@mui/icons-material/Refresh";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import SyncIcon from "@mui/icons-material/Sync";

import { LOG_STREAMS, type ClaudeMode, type LogLine, type LogStream, type ServiceRole, type StageId, type StageState, type StageStatus } from "../../shared/types";
import { api } from "../api";
import { MONO } from "../theme";
import { ClaudePanel } from "./ClaudePanel";
import { JobsPanel } from "./JobsPanel";
import { ApiPanel } from "./ApiPanel";

//
// The console pane. Tabs: one per log stream (Build / Docker / Deploy / Runtime), plus Claude (the
// in-app agent) and Jobs (Lambdas). Log tabs get a substring filter, autoscroll, clear, and the
// on-disk path. The Runtime tab adds a role filter (e.g. app-main / app-public) since a compose
// deploy multiplexes every container's logs into one stream.
//

type TabValue = LogStream | "web" | "api" | "claude" | "jobs";

const ANSI = /\[[0-9;]*m/g;

const STREAM_LABEL : Record<LogStream, string> = { build: "Build", image: "Docker", deploy: "Deploy", runtime: "Runtime" };

const LEVEL_COLOR = { out: "#c9d1d9", err: "#f85149", sys: "#58a6ff" } as const;

const MAX_RENDER = 2500;

/** The structured levels we filter on (matches Trace's labels). */
const LEVELS = [ "INFO", "WARN", "ERROR" ] as const;

function isLogStream( v : TabValue ) : v is LogStream
{
    return ( LOG_STREAMS as string[] ).includes( v );
}

//
// ── structured (Trace JSON) log parsing ────────────────────────────────────────────────────────
// Runtime lines are our Trace records ({level,time,name,id,message,args}) wrapped in docker-compose's
// "<container> | …" prefix. We parse each line once (cached per line object) into a structured record
// so it can be rendered as columns + color-coded, with the data payload shown compact (pretty on click).
//
interface TraceRecord { level : string; time? : string; name? : string; id? : string; message? : string; args? : unknown[]; }
interface Parsed { prefix? : string; record? : TraceRecord; raw : string; }

const parseCache = new WeakMap<LogLine, Parsed>();

function parseLine( line : LogLine ) : Parsed
{
    const hit : Parsed | undefined = parseCache.get( line );
    if ( hit ) return hit;

    const stripped : string = line.text.replace( ANSI, "" );

    // peel a docker-compose container prefix ("name  | rest"), but only a real name token, and only
    // when the bar comes before any JSON brace (so build-log table rows aren't mis-split)
    let prefix : string | undefined;
    let body : string = stripped;
    const bar : number = stripped.indexOf( "| " );
    const brace : number = stripped.indexOf( "{" );
    if ( bar > 0 && ( brace === -1 || bar < brace ) )
    {
        const candidate : string = stripped.slice( 0, bar ).trim();
        if ( /^[\w.-]+$/.test( candidate ) ) { prefix = candidate; body = stripped.slice( bar + 2 ); }
    }

    let record : TraceRecord | undefined;
    const t : string = body.trim();
    if ( t.startsWith( "{" ) && t.endsWith( "}" ) )
    {
        try
        {
            const obj : Record<string, unknown> = JSON.parse( t ) as Record<string, unknown>;
            if ( obj && typeof obj.level === "string" && "message" in obj ) record = obj as unknown as TraceRecord;
        }
        catch { /* not a Trace record — leave as raw */ }
    }

    const parsed : Parsed = { prefix, record, raw: stripped };
    parseCache.set( line, parsed );
    return parsed;
}

/** ISO "…T12:34:56.789Z" → "12:34:56.789". */
function fmtTime( iso? : string ) : string
{
    if ( !iso ) return "";
    const m : RegExpMatchArray | null = iso.match( /T(\d{2}:\d{2}:\d{2}\.\d{3})/ );
    return m ? m[ 1 ] : iso;
}

function recLevelColor( level : string ) : string
{
    switch ( level.toUpperCase() )
    {
        case "ERROR": case "FATAL":   return "#f85149";
        case "WARN":  case "WARNING": return "#d29922";
        case "INFO":                  return "#3fb950";
        case "DEBUG": case "TRACE":   return "#8b949e";
        default:                       return "#58a6ff";
    }
}

// One rendered log line: a structured Trace record (columns + color + expandable JSON) or raw text.
function LogRow( { line } : { line : LogLine } )
{
    const [ open, setOpen ] = useState<boolean>( false );
    const p : Parsed = parseLine( line );

    if ( !p.record )
        return (
            <Box component="pre" sx={{ m: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", color: LEVEL_COLOR[ line.level ] }}>
                {p.raw}
            </Box>
        );

    const rec : TraceRecord = p.record;
    const color : string = recLevelColor( rec.level );
    const data : unknown = Array.isArray( rec.args ) ? ( rec.args.length === 1 ? rec.args[ 0 ] : rec.args ) : rec.args;
    const hasData : boolean = data !== undefined && !( Array.isArray( data ) && data.length === 0 );

    return (
        <Box
            onClick={() => { if ( hasData ) setOpen( ( o ) => !o ); }}
            sx={{ py: 0.15, borderRadius: 0.5, cursor: hasData ? "pointer" : "default", "&:hover": hasData ? { bgcolor: "rgba(255,255,255,0.03)" } : undefined }}
        >
            <Box sx={{ display: "flex", gap: 1, alignItems: "baseline", flexWrap: "wrap" }}>
                <Box component="span" sx={{ color: "#6e7681" }}>{fmtTime( rec.time )}</Box>
                <Box component="span" sx={{ color, fontWeight: 700, minWidth: 40 }}>{rec.level.toUpperCase()}</Box>
                {rec.name && <Box component="span" sx={{ color: "#79c0ff" }}>{rec.name}</Box>}
                {rec.id && <Box component="span" sx={{ color: "#6e7681" }}>{rec.id}</Box>}
                <Box component="span" sx={{ color: "#e6edf3" }}>{rec.message}</Box>
                {hasData && !open && (
                    <Box component="span" sx={{ color: "#8b949e", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {JSON.stringify( data )}
                    </Box>
                )}
            </Box>
            {hasData && open && (
                <Box component="pre" sx={{ m: 0, mt: 0.25, ml: 2, color: "#8b949e", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {JSON.stringify( data, null, 2 )}
                </Box>
            )}
        </Box>
    );
}

/** Per-stage status dot color on the Build/Docker/Deploy tabs: idle grey · running amber · success green · failed red. */
function stageDotColor( status : StageStatus | undefined ) : string | null
{
    switch ( status )
    {
        case "success": return "#3fb950";
        case "failed":  return "#f85149";
        case "running": return "#d29922";
        case "idle":    return "#6e7681";
        case "skipped": return "#484f58";
        default:        return null;
    }
}

export function ConsoleView(
    { service, roles, stages, runningStreams, claudeMode, onClaudeMode, isFrontend } :
    {
        service : string;
        roles : ServiceRole[];
        stages : StageState;
        runningStreams : Set<LogStream>;
        claudeMode : ClaudeMode;
        onClaudeMode : ( m : ClaudeMode ) => void;
        isFrontend : boolean;
    }
)
{
    // a frontend (SPA) has no Docker image, no compose runtime, and serves no API endpoints — drop those tabs
    const visibleStreams : LogStream[] = isFrontend
        ? LOG_STREAMS.filter( ( s ) => s !== "image" && s !== "runtime" )
        : LOG_STREAMS;
    const [ tab, setTab ]         = useState<TabValue>( isFrontend ? "web" : "build" );
    const [ lines, setLines ]     = useState<LogLine[]>( [] );
    const [ filter, setFilter ]   = useState<string>( "" );
    const [ autoscroll, setAuto ] = useState<boolean>( true );
    const [ logFile, setLogFile ] = useState<string>( "" );
    const [ roleFilter, setRoleFilter ] = useState<string[]>( [] );   // empty = all roles (runtime tab)
    const [ levelFilter, setLevelFilter ] = useState<string[]>( [] ); // empty = all levels

    const endRef = useRef<HTMLDivElement | null>( null );

    const stream : LogStream | null = isLogStream( tab ) ? tab : null;

    // load history + subscribe for log streams
    useEffect( () =>
    {
        if ( !stream ) return;
        let active : boolean = true;
        void api.getLog( service, stream ).then( ( hist : LogLine[] ) => { if ( active ) setLines( hist ); } );
        void api.logPath( service, stream ).then( ( p : string ) => { if ( active ) setLogFile( p ); } );

        const off : () => void = api.onLog( ( line : LogLine ) =>
        {
            if ( line.service === service && line.stream === stream )
                setLines( ( prev ) => ( prev.length > MAX_RENDER ? [ ...prev.slice( -MAX_RENDER ), line ] : [ ...prev, line ] ) );
        } );

        return () => { active = false; off(); };
    }, [ service, stream ] );

    // role-prefix match for the runtime tab (docker compose prefixes lines with "<service>-<role>")
    const roleMatches = ( text : string ) : boolean =>
    {
        if ( roleFilter.length === 0 ) return true;
        const t : string = text.replace( ANSI, "" ).trimStart();
        return roleFilter.some( ( r : string ) => t.startsWith( `${service}-${r}` ) );
    };

    // any structured (Trace JSON) lines present? → show the level filter (parsed once, cached)
    const hasRecords : boolean = useMemo<boolean>( () => lines.some( ( l ) => parseLine( l ).record !== undefined ), [ lines ] );

    const shown : LogLine[] = useMemo<LogLine[]>( () =>
    {
        let out = lines;
        if ( stream === "runtime" && roleFilter.length > 0 )
            out = out.filter( ( l ) => l.level === "sys" || roleMatches( l.text ) );
        if ( levelFilter.length > 0 )
            out = out.filter( ( l ) => { const r = parseLine( l ).record; return !r || levelFilter.includes( r.level.toUpperCase() ); } );
        if ( filter )
            out = out.filter( ( l ) => l.text.toLowerCase().includes( filter.toLowerCase() ) );
        return out;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ lines, filter, roleFilter, levelFilter, stream ] );

    useLayoutEffect( () => { if ( autoscroll && stream ) endRef.current?.scrollIntoView( { block: "end" } ); }, [ shown, autoscroll, stream ] );

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
                    {visibleStreams.map( ( s ) =>
                    {
                        // build/image/deploy get the STAGE status dot; runtime keeps a running indicator
                        const dot : string | null = s === "runtime"
                            ? ( runningStreams.has( s ) ? "#d29922" : null )
                            : stageDotColor( stages[ s as StageId ] );
                        return (
                            <Tab
                                key={s}
                                value={s}
                                label={
                                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.7 }}>
                                        {STREAM_LABEL[ s ]}
                                        {dot && <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: dot }} />}
                                    </Box>
                                }
                            />
                        );
                    } )}
                    {!isFrontend && <Tab value="api" label="API" />}
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
                            <ToggleButtonGroup size="small" value={roleFilter} onChange={( _e, next : string[] ) => setRoleFilter( next )}>
                                {roles.map( ( r ) => (
                                    <ToggleButton key={r.role} value={r.role} sx={{ px: 1.25, py: 0.2, fontFamily: MONO, fontSize: 11 }}>
                                        {service}-{r.role}
                                    </ToggleButton>
                                ) )}
                            </ToggleButtonGroup>
                        </Box>
                    )}
                    {hasRecords && (
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                            <Typography variant="caption" sx={{ color: "text.disabled" }}>level</Typography>
                            <ToggleButtonGroup size="small" value={levelFilter} onChange={( _e, next : string[] ) => setLevelFilter( next )}>
                                {LEVELS.map( ( lv ) => (
                                    <ToggleButton key={lv} value={lv} sx={{ px: 1.25, py: 0.2, fontFamily: MONO, fontSize: 11, color: recLevelColor( lv ), "&.Mui-selected": { color: recLevelColor( lv ), fontWeight: 700 } }}>
                                        {lv}
                                    </ToggleButton>
                                ) )}
                            </ToggleButtonGroup>
                        </Box>
                    )}
                </Box>
            )}

            {/* body */}
            {tab === "web"
                ? <Box sx={{ flexGrow: 1, minHeight: 0 }}><WebAppPanel service={service} roles={roles} devRunning={runningStreams.has( "runtime" )} /></Box>
                : tab === "api"
                ? <Box sx={{ flexGrow: 1, minHeight: 0 }}><ApiPanel service={service} roles={roles} /></Box>
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
                                          {filter || roleFilter.length > 0 || levelFilter.length > 0 ? "no lines match the filter" : "no output yet — run a stage"}
                                      </Typography>
                                    : shown.map( ( l ) => <LogRow key={`${l.stream}-${l.seq}`} line={l} /> )}
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
function WebAppPanel( { service, roles, devRunning } : { service : string; roles : ServiceRole[]; devRunning : boolean } )
{
    const [ url, setUrl ]     = useState<string | undefined>();
    const [ err, setErr ]     = useState<string | undefined>();
    const [ busy, setBusy ]   = useState<boolean>( false );
    const [ syncing, setSyncing ] = useState<boolean>( false );
    const [ syncErr, setSyncErr ] = useState<string | undefined>();

    // vite dev server — the main role's port (web → 5173)
    const devPort : number = roles.find( ( r ) => r.role === "main" )?.port ?? roles[ 0 ]?.port ?? 5173;
    const devUrl  : string = `http://localhost:${devPort}`;

    const load = useCallback( async () : Promise<void> =>
    {
        setBusy( true );
        try { const r = await api.webAppUrl( service ); setUrl( r.url ); setErr( r.error ); }
        finally { setBusy( false ); }
    }, [ service ] );

    useEffect( () => { void load(); void api.watchSyncState( service ).then( setSyncing ); }, [ load, service ] );

    const toggleSync = async () : Promise<void> =>
    {
        setSyncErr( undefined );
        if ( syncing ) { await api.watchSyncStop( service ); setSyncing( false ); return; }
        const r = await api.watchSyncStart( service );
        if ( r.ok ) setSyncing( true ); else setSyncErr( r.error );
    };

    return (
        <Box sx={{ flexGrow: 1, minHeight: 0, overflow: "auto", p: 2, display: "flex", flexDirection: "column", gap: 2 }}>
            {/* dev server — the fast loop (HMR) */}
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1, p: 1.5, border: "1px solid", borderColor: "divider", borderRadius: 1.5 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Dev server (vite · HMR)</Typography>
                    <Chip size="small" variant="outlined" color={devRunning ? "success" : "default"}
                          label={devRunning ? "running" : "stopped"} />
                    <Box sx={{ flexGrow: 1 }} />
                    {devRunning
                        ? <Button size="small" color="error" variant="outlined" startIcon={<StopIcon />} onClick={() => void api.devStop( service )}>Stop</Button>
                        : <Button size="small" color="success" variant="contained" startIcon={<PlayArrowIcon />} onClick={() => void api.devStart( service )}>Start</Button>}
                </Box>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Typography variant="body2" sx={{ fontFamily: MONO, color: "text.secondary", flexGrow: 1 }}>{devUrl}</Typography>
                    <Tooltip title="Copy URL"><IconButton size="small" onClick={() => void navigator.clipboard.writeText( devUrl )}><ContentCopyIcon sx={{ fontSize: 15 }} /></IconButton></Tooltip>
                    <Button size="small" variant="contained" color="primary" startIcon={<OpenInNewIcon />} disabled={!devRunning} onClick={() => void api.openExternal( devUrl )}>Open</Button>
                </Box>
                <Typography variant="caption" sx={{ color: "text.disabled" }}>
                    The fast loop: hot-reload, no build/deploy. Output streams to the Build log. Open is enabled once the server is up.
                </Typography>
            </Box>

            {/* deployed build (S3 + CloudFront) + fast watch-sync */}
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1, p: 1.5, border: "1px solid", borderColor: "divider", borderRadius: 1.5 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Deployed build (S3 + CloudFront)</Typography>
                    <Box sx={{ flexGrow: 1 }} />
                    <Tooltip title="vite build --watch → sync bin/ to the S3 bucket (no cdk deploy)">
                        <Button size="small" variant={syncing ? "contained" : "outlined"} color={syncing ? "success" : "inherit"}
                                startIcon={<SyncIcon sx={{ animation: syncing ? "spin 2s linear infinite" : "none", "@keyframes spin": { to: { transform: "rotate(360deg)" } } }} />}
                                onClick={() => void toggleSync()}>{syncing ? "Watching" : "Watch & sync"}</Button>
                    </Tooltip>
                    <Tooltip title="Re-read the deployed URL from the stack output (after a deploy / target switch). Does not refresh the browser or redeploy.">
                        <Button size="small" variant="outlined" startIcon={busy ? <CircularProgress size={13} /> : <RefreshIcon fontSize="small" />}
                                onClick={() => void load()}>Refresh</Button>
                    </Tooltip>
                </Box>
                {syncErr && <Typography variant="caption" sx={{ color: "error.main" }}>{syncErr}</Typography>}
                {url
                    ? (
                        <>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                <Typography variant="body2" sx={{ fontFamily: MONO, color: "text.secondary", wordBreak: "break-all", flexGrow: 1 }}>{url}</Typography>
                                <Tooltip title="Copy URL"><IconButton size="small" onClick={() => void navigator.clipboard.writeText( url )}><ContentCopyIcon sx={{ fontSize: 15 }} /></IconButton></Tooltip>
                                <Button size="small" variant="contained" color="success" startIcon={<OpenInNewIcon />} onClick={() => void api.openExternal( url )}>Open</Button>
                            </Box>
                            <Typography variant="caption" sx={{ color: "text.disabled" }}>
                                Production-like artifact. On LocalStack, CloudFront is partially emulated and untrusted-TLS — prefer the dev server day to day; use this to validate the built bundle.
                            </Typography>
                        </>
                    )
                    : <Typography variant="caption" sx={{ color: "text.disabled" }}>
                          {err
                              ? `Couldn't read the deployed URL: ${err}`
                              : "Not deployed yet. Run Build + Deploy once (creates the bucket + distribution), then Refresh — after that, Watch & sync pushes changes without a full deploy."}
                      </Typography>}
            </Box>
        </Box>
    );
}
