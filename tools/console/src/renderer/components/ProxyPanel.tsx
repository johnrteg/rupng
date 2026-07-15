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

/** Read the per-dev routing choices from localStorage, falling back to local defaults. */
export function loadRouting() : Routing
{
    try { const saved = JSON.parse( localStorage.getItem( LS_KEY ) ?? "" ) as Routing; return { env: saved.env ?? "local", modes: saved.modes ?? {}, port: saved.port ?? PROXY_DEFAULT_PORT }; }
    catch { return { env: "local", modes: {}, port: PROXY_DEFAULT_PORT }; }
}
/** Persist the routing choices for this developer. */
function saveRouting( routing : Routing ) : void { localStorage.setItem( LS_KEY, JSON.stringify( routing ) ); }

/** Outside = local container, Inside = deployed cloud. Resolve each upstream's effective target. */
function targetFor( upstream : ProxyUpstream, mode : RouteMode ) : string
{
    const outside : string = upstream.outside ?? upstream.target;
    return mode === "inside" ? ( upstream.inside ?? upstream.target ) : outside;
}

/** The discovered gateway URL for an upstream — only when all its prefixes resolve to the SAME API. */
function gatewayFor( upstream : ProxyUpstream, gateways : Record<string, string> ) : string | undefined
{
    const urls : Set<string> = new Set( upstream.prefixes.map( ( prefix ) => gateways[ prefix ] ).filter( Boolean ) as Array<string> );
    return urls.size === 1 ? [ ...urls ][ 0 ] : undefined;
}

/** Fill each upstream's `inside` candidate from discovered gateway targets (keeps any explicit value). */
function withGateways( base : ProxyConfig, gateways : Record<string, string> ) : ProxyConfig
{
    return { web: base.web, upstreams: base.upstreams.map( ( upstream ) => ( { ...upstream, inside: upstream.inside ?? gatewayFor( upstream, gateways ) } ) ) };
}

/** Build the config the proxy actually runs with from the env's base config + per-service modes. */
function effective( base : ProxyConfig, isLocal : boolean, modes : Record<string, RouteMode> ) : ProxyConfig
{
    if ( !isLocal ) return base;   // remote: every service is Inside — targets are the committed remote ones
    return { web: base.web, upstreams: base.upstreams.map( ( upstream ) => ( { ...upstream, target: targetFor( upstream, modes[ upstream.name ] ?? "outside" ) } ) ) };
}

/** The Web → Proxy sub-tab: pick the backend env + per-service Outside/Inside routing, then start/restart the edge. */
export function ProxyPanel()
{
    const initial : Routing = loadRouting();
    const [ env, setEnv ]     = useState<string>( initial.env );
    const [ modes, setModes ] = useState<Record<string, RouteMode>>( initial.modes );
    const [ port, setPort ]   = useState<number>( initial.port );
    const [ envs, setEnvs ]   = useState<Array<string>>( [] );
    const [ base, setBase ]   = useState<ProxyConfig | null>( null );
    const [ gw, setGw ]       = useState<Record<string, string>>( {} );
    const [ running, setRunning ] = useState<boolean>( false );
    const [ err, setErr ]     = useState<string | undefined>();
    const [ lines, setLines ] = useState<Array<LogLine>>( [] );

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
        void api.proxyConfigGet( env ).then( ( res ) => { setBase( res.config ?? null ); setErr( res.error ); } );
        void api.proxyGatewayTargets().then( ( res ) => setGw( res.prefixes ) );
        saveRouting( { env, modes, port } );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ env ] );

    // tail the proxy console
    useEffect( () =>
    {
        let active : boolean = true;
        void api.getLog( WEBPROXY_ID, "runtime" ).then( ( hist : Array<LogLine> ) => { if ( active ) setLines( hist ); } );
        const off : () => void = api.onLog( ( line : LogLine ) =>
        {
            if ( line.service === WEBPROXY_ID && line.stream === "runtime" )
                setLines( ( prev ) => ( prev.length > 800 ? [ ...prev.slice( -800 ), line ] : [ ...prev, line ] ) );
        } );
        return () => { active = false; off(); };
    }, [] );

    /** Set one service's Outside/Inside mode and persist the routing. */
    const setMode = ( name : string, mode : RouteMode ) : void =>
    {
        const next : Record<string, RouteMode> = { ...modes, [ name ]: mode };
        setModes( next );
        saveRouting( { env, modes: next, port } );
    };

    /** Change the edge listen port and persist it. */
    const changePort = ( nextPort : number ) : void => { setPort( nextPort ); saveRouting( { env, modes, port: nextPort } ); };

    /** Require explicit confirmation before routing the local SPA at the live production cloud. */
    const guard = () : boolean => env !== "production" || window.confirm( "Route to PRODUCTION? Your local SPA will hit live production APIs." );

    /** Write the derived config (.active) and (re)start the edge with it. */
    const apply = async ( restart : boolean ) : Promise<void> =>
    {
        if ( !cfg || !guard() ) return;
        const built : ProxyConfig = effective( cfg, isLocal, modes );
        // LOCAL: generate the per-endpoint route table from the endpoint→role bindings so /api/{service}
        // dispatches to the right role port (mirrors the gateway). REMOTE: cloud does the dispatch.
        if ( isLocal ) built.routes = await api.proxyLocalRoutes();
        const r = await api.proxyApply( built );
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
                        {envs.map( ( name ) => <MenuItem key={name} value={name}>{name}</MenuItem> )}
                    </Select>
                </Tooltip>
                {env === "production" && <Chip size="small" color="warning" label="LIVE" />}
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
                                {cfg.upstreams.map( ( upstream ) => (
                                    <Box key={upstream.name} sx={{ fontFamily: MONO, fontSize: 12, color: "text.disabled" }}>{upstream.prefixes.join( " " )} ({upstream.name}) → {upstream.inside ?? upstream.target}</Box>
                                ) )}
                            </Box>
                        </Typography>
                    )}

                    {cfg && isLocal && (
                        <>
                            <Typography variant="caption" sx={{ color: "text.disabled", display: "block", mb: 0.75 }}>
                                Per service: <b>Outside</b> = run it locally · <b>Inside</b> = leave it deployed in LocalStack
                            </Typography>
                            <Typography variant="caption" sx={{ color: "text.disabled", display: "block", mb: 0.75 }}>
                                <b>/api</b> is auto-dispatched per endpoint to the role-service that owns it (generated from the
                                endpoint→role bindings on Apply) — so a service can split into more roles without changing any URL.
                            </Typography>
                            {cfg.upstreams.map( ( upstream ) =>
                            {
                                const mode : RouteMode = modes[ upstream.name ] ?? "outside";
                                const insideDisabled : boolean = !upstream.inside;
                                return (
                                    <Box key={upstream.name} sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.75 }}>
                                        <Box sx={{ width: 170, flexShrink: 0, fontFamily: MONO, fontSize: 13 }}>
                                            <Box component="span">{upstream.prefixes.join( " " )}</Box>{" "}
                                            <Box component="span" sx={{ color: "text.disabled" }}>({upstream.name})</Box>
                                        </Box>
                                        <ToggleButtonGroup size="small" exclusive value={mode} onChange={( _e, next : RouteMode | null ) => next && setMode( upstream.name, next )}>
                                            <ToggleButton value="outside" sx={{ px: 1.5, py: 0.2 }}>Outside</ToggleButton>
                                            <Tooltip title={insideDisabled ? "no gateway URL yet (pending the LocalStack API Gateway data-path fix)" : "route to the deployed service"}>
                                                <span><ToggleButton value="inside" disabled={insideDisabled} sx={{ px: 1.5, py: 0.2 }}>Inside</ToggleButton></span>
                                            </Tooltip>
                                        </ToggleButtonGroup>
                                        <Typography variant="caption" sx={{ color: "text.disabled", fontFamily: MONO, flexGrow: 1, wordBreak: "break-all" }}>→ {targetFor( upstream, mode )}</Typography>
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
