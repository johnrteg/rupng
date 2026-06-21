import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import ReplayIcon from "@mui/icons-material/Replay";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";

import { WEBPROXY_ID, type LogLine, type ProcState, type ProxyConfig, type ProxyUpstream, type RouteMode } from "../../shared/types";
import { api } from "../api";
import { MONO } from "../theme";
import { LogView } from "./LogView";

//
// The Web → Proxy sub-tab: the dev's first decision. Two levels —
//   1. Backend ENVIRONMENT (config): local (LocalStack) or a remote AWS env (dev/staging/production).
//   2. For `local` only, a per-service OUTSIDE/INSIDE board — Outside = a locally-run container,
//      Inside = the deployed cloud. For remote envs everything is Inside (web is the only local piece).
// The console is the source of truth: it derives the proxy's `.active` config from these choices,
// persists them per-dev (localStorage), and (re)starts the edge. Choices survive app restarts.
//

export const PROXY_DEFAULT_PORT = 9000;   // 8080 is commonly taken by other local proxies
const LS_KEY = "rup.proxy.routing";

interface Routing { env : string; modes : Record<string, RouteMode>; port : number; }

export function loadRouting() : Routing
{
    try { const r = JSON.parse( localStorage.getItem( LS_KEY ) ?? "" ) as Routing; return { env: r.env ?? "local", modes: r.modes ?? {}, port: r.port ?? PROXY_DEFAULT_PORT }; }
    catch { return { env: "local", modes: {}, port: PROXY_DEFAULT_PORT }; }
}
function saveRouting( r : Routing ) : void { localStorage.setItem( LS_KEY, JSON.stringify( r ) ); }

/** Outside = local container, Inside = deployed cloud. Resolve each upstream's effective target. */
function targetFor( u : ProxyUpstream, mode : RouteMode ) : string
{
    const outside : string = u.outside ?? u.target;
    return mode === "inside" ? ( u.inside ?? u.target ) : outside;
}

/** The discovered gateway URL for an upstream — only when all its prefixes resolve to the SAME API. */
function gatewayFor( u : ProxyUpstream, gw : Record<string, string> ) : string | undefined
{
    const urls : Set<string> = new Set( u.prefixes.map( ( p ) => gw[ p ] ).filter( Boolean ) as string[] );
    return urls.size === 1 ? [ ...urls ][ 0 ] : undefined;
}

/** Fill each upstream's `inside` candidate from discovered gateway targets (keeps any explicit value). */
function withGateways( base : ProxyConfig, gw : Record<string, string> ) : ProxyConfig
{
    return { web: base.web, upstreams: base.upstreams.map( ( u ) => ( { ...u, inside: u.inside ?? gatewayFor( u, gw ) } ) ) };
}

/** Build the config the proxy actually runs with from the env's base config + per-service modes. */
function effective( base : ProxyConfig, isLocal : boolean, modes : Record<string, RouteMode> ) : ProxyConfig
{
    if ( !isLocal ) return base;   // remote: every service is Inside — targets are the committed remote ones
    return { web: base.web, upstreams: base.upstreams.map( ( u ) => ( { ...u, target: targetFor( u, modes[ u.name ] ?? "outside" ) } ) ) };
}

export function ProxyPanel()
{
    const initial : Routing = loadRouting();
    const [ env, setEnv ]     = useState<string>( initial.env );
    const [ modes, setModes ] = useState<Record<string, RouteMode>>( initial.modes );
    const [ port, setPort ]   = useState<number>( initial.port );
    const [ envs, setEnvs ]   = useState<string[]>( [] );
    const [ base, setBase ]   = useState<ProxyConfig | null>( null );
    const [ gw, setGw ]       = useState<Record<string, string>>( {} );
    const [ running, setRunning ] = useState<boolean>( false );
    const [ err, setErr ]     = useState<string | undefined>();
    const [ lines, setLines ] = useState<LogLine[]>( [] );

    const isLocal : boolean = env === "local";
    const cfg : ProxyConfig | null = base ? withGateways( base, gw ) : null;   // base + discovered Inside targets

    // running state + available env configs
    useEffect( () =>
    {
        void api.proxyState().then( setRunning );
        void api.proxyConfigList().then( setEnvs );
        const off : () => void = api.onProc( ( p : ProcState ) => { if ( p.service === WEBPROXY_ID && p.stream === "runtime" ) setRunning( p.running ); } );
        return off;
    }, [] );

    // load the selected env's base config + discover gateway (Inside) targets
    useEffect( () =>
    {
        void api.proxyConfigGet( env ).then( ( r ) => { setBase( r.config ?? null ); setErr( r.error ); } );
        void api.proxyGatewayTargets().then( ( r ) => setGw( r.prefixes ) );
        saveRouting( { env, modes, port } );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ env ] );

    // tail the proxy console
    useEffect( () =>
    {
        let active : boolean = true;
        void api.getLog( WEBPROXY_ID, "runtime" ).then( ( hist : LogLine[] ) => { if ( active ) setLines( hist ); } );
        const off : () => void = api.onLog( ( line : LogLine ) =>
        {
            if ( line.service === WEBPROXY_ID && line.stream === "runtime" )
                setLines( ( prev ) => ( prev.length > 800 ? [ ...prev.slice( -800 ), line ] : [ ...prev, line ] ) );
        } );
        return () => { active = false; off(); };
    }, [] );

    const setMode = ( name : string, mode : RouteMode ) : void =>
    {
        const next : Record<string, RouteMode> = { ...modes, [ name ]: mode };
        setModes( next );
        saveRouting( { env, modes: next, port } );
    };

    const changePort = ( p : number ) : void => { setPort( p ); saveRouting( { env, modes, port: p } ); };

    const guard = () : boolean => env !== "production" || window.confirm( "Route to PRODUCTION? Your local SPA will hit live production APIs." );

    /** Write the derived config (.active) and (re)start the edge with it. */
    const apply = async ( restart : boolean ) : Promise<void> =>
    {
        if ( !cfg || !guard() ) return;
        const r = await api.proxyApply( effective( cfg, isLocal, modes ) );
        if ( !r.ok ) { setErr( r.error ); return; }
        if ( restart ) void api.proxyRestart( port ); else void api.proxyStart( port );
    };

    return (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
            {/* level 1 — environment + lifecycle */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider", flexWrap: "wrap" }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Edge → backend</Typography>
                <Tooltip title="Which cloud the proxy routes APIs to">
                    <Select size="small" value={env} onChange={( e ) => setEnv( e.target.value )} sx={{ minWidth: 150 }}>
                        {envs.map( ( c ) => <MenuItem key={c} value={c}>{c}</MenuItem> )}
                    </Select>
                </Tooltip>
                {env === "production" && <Chip size="small" color="error" label="LIVE" />}
                <Tooltip title="Edge listen port (the browser connects here)">
                    <TextField size="small" label="port" type="number" value={port}
                               onChange={( e ) => changePort( parseInt( e.target.value ) || PROXY_DEFAULT_PORT )}
                               sx={{ width: 96 }} InputProps={{ sx: { fontFamily: MONO } }} />
                </Tooltip>
                <Chip size="small" variant="outlined" color={running ? "success" : "default"} label={running ? `running :${port}` : "stopped"} />

                <Box sx={{ flexGrow: 1 }} />

                {running
                    ? <>
                        <Button size="small" variant="contained" color="success" startIcon={<ReplayIcon />} onClick={() => void apply( true )}>Apply &amp; restart</Button>
                        <Button size="small" color="error" variant="outlined" startIcon={<StopIcon />} onClick={() => void api.proxyStop()}>Stop</Button>
                      </>
                    : <Button size="small" color="success" variant="contained" startIcon={<PlayArrowIcon />} onClick={() => void apply( false )}>Start</Button>}
                <Tooltip title="Open the edge"><span>
                    <Button size="small" variant="outlined" startIcon={<OpenInNewIcon />} disabled={!running} onClick={() => void api.openExternal( `http://localhost:${port}` )}>:{port}</Button>
                </span></Tooltip>
            </Box>

            {/* level 2 — routing board (left, grows with services) + proxy console (right) */}
            <Box sx={{ display: "flex", flexGrow: 1, minHeight: 0 }}>
                {/* routing board */}
                <Box sx={{ flexGrow: 1, minWidth: 0, p: 1.5, overflow: "auto" }}>
                    {err && <Typography variant="caption" sx={{ color: "error.main", display: "block", mb: 1 }}>{err}</Typography>}

                    {cfg && !isLocal && (
                        <Typography variant="caption" sx={{ color: "text.secondary" }}>
                            Remote env — web is served locally; every service routes to the <b>{env}</b> cloud:
                            <Box component="span" sx={{ display: "block", mt: 0.5 }}>
                                {cfg.upstreams.map( ( u ) => (
                                    <Box key={u.name} sx={{ fontFamily: MONO, fontSize: 12, color: "text.disabled" }}>{u.prefixes.join( " " )} ({u.name}) → {u.inside ?? u.target}</Box>
                                ) )}
                            </Box>
                        </Typography>
                    )}

                    {cfg && isLocal && (
                        <>
                            <Typography variant="caption" sx={{ color: "text.disabled", display: "block", mb: 0.75 }}>
                                Per service: <b>Outside</b> = run it locally · <b>Inside</b> = leave it deployed in LocalStack
                            </Typography>
                            {cfg.upstreams.map( ( u ) =>
                            {
                                const mode : RouteMode = modes[ u.name ] ?? "outside";
                                const insideDisabled : boolean = !u.inside;
                                return (
                                    <Box key={u.name} sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.75 }}>
                                        <Box sx={{ width: 170, flexShrink: 0, fontFamily: MONO, fontSize: 13 }}>
                                            <Box component="span">{u.prefixes.join( " " )}</Box>{" "}
                                            <Box component="span" sx={{ color: "text.disabled" }}>({u.name})</Box>
                                        </Box>
                                        <ToggleButtonGroup size="small" exclusive value={mode} onChange={( _e, v : RouteMode | null ) => v && setMode( u.name, v )}>
                                            <ToggleButton value="outside" sx={{ px: 1.5, py: 0.2 }}>Outside</ToggleButton>
                                            <Tooltip title={insideDisabled ? "no gateway URL yet (pending the LocalStack API Gateway data-path fix)" : "route to the deployed service"}>
                                                <span><ToggleButton value="inside" disabled={insideDisabled} sx={{ px: 1.5, py: 0.2 }}>Inside</ToggleButton></span>
                                            </Tooltip>
                                        </ToggleButtonGroup>
                                        <Typography variant="caption" sx={{ color: "text.disabled", fontFamily: MONO, flexGrow: 1, wordBreak: "break-all" }}>→ {targetFor( u, mode )}</Typography>
                                    </Box>
                                );
                            } )}
                            <Typography variant="caption" sx={{ color: "text.disabled", display: "block", mt: 1 }}>
                                Choices are saved per-developer and survive restarts. Click {running ? "“Apply & restart”" : "“Start”"} to route accordingly.
                            </Typography>
                        </>
                    )}
                </Box>

                {/* proxy console — shared Trace formatter + filters */}
                <Box sx={{ width: "44%", minWidth: 340, flexShrink: 0, borderLeft: "1px solid", borderColor: "divider", minHeight: 0 }}>
                    <LogView lines={lines} empty="no output — start the edge" hideId />
                </Box>
            </Box>
        </Box>
    );
}
