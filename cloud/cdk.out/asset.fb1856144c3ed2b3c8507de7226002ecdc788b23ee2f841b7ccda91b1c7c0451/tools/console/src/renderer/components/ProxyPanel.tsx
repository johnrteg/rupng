import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import ReplayIcon from "@mui/icons-material/Replay";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import SaveIcon from "@mui/icons-material/Save";

import { WEBPROXY_ID, type LogLine, type ProcState, type ProxyConfig } from "../../shared/types";
import { api } from "../api";
import { MONO } from "../theme";

//
// The Web → Proxy sub-tab. The webproxy is the LOCAL edge (serves the built SPA + reverse-proxies
// API/WS to services). This panel shows its config (which host each prefix calls), lets you edit the
// upstream targets + pick the active env config, start/stop/restart it, and tails its console output.
//

const PROXY_URL = "http://localhost:8080";

export function ProxyPanel()
{
    const [ running, setRunning ] = useState<boolean>( false );
    const [ configs, setConfigs ] = useState<string[]>( [] );
    const [ sel, setSel ]         = useState<string>( "local" );
    const [ cfg, setCfg ]         = useState<ProxyConfig | null>( null );
    const [ err, setErr ]         = useState<string | undefined>();
    const [ dirty, setDirty ]     = useState<boolean>( false );
    const [ lines, setLines ]     = useState<LogLine[]>( [] );
    const endRef = useRef<HTMLDivElement | null>( null );

    // running state — initial + live proc events for the webproxy slot
    useEffect( () =>
    {
        void api.proxyState().then( setRunning );
        const off : () => void = api.onProc( ( p : ProcState ) =>
        {
            if ( p.service === WEBPROXY_ID && p.stream === "runtime" ) setRunning( p.running );
        } );
        return off;
    }, [] );

    // available configs
    useEffect( () =>
    {
        void api.proxyConfigList().then( ( names : string[] ) =>
        {
            setConfigs( names );
            setSel( ( cur ) => names.includes( cur ) ? cur : ( names.includes( "local" ) ? "local" : names[ 0 ] ?? "local" ) );
        } );
    }, [] );

    // load the selected config
    useEffect( () =>
    {
        if ( !sel ) return;
        void api.proxyConfigGet( sel ).then( ( r : { config? : ProxyConfig; error? : string } ) =>
        {
            setCfg( r.config ?? null );
            setErr( r.error );
            setDirty( false );
        } );
    }, [ sel ] );

    // tail the proxy console (runtime stream)
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

    useLayoutEffect( () => { endRef.current?.scrollIntoView( { block: "end" } ); }, [ lines ] );

    const setTarget = ( i : number, target : string ) : void =>
    {
        if ( !cfg ) return;
        const next : ProxyConfig = { ...cfg, upstreams: cfg.upstreams.map( ( u, j ) => j === i ? { ...u, target } : u ) };
        setCfg( next );
        setDirty( true );
    };

    const save = async ( restart : boolean ) : Promise<void> =>
    {
        if ( !cfg ) return;
        const r = await api.proxyConfigSave( sel, cfg );
        if ( !r.ok ) { setErr( r.error ); return; }
        setDirty( false );
        if ( restart ) void api.proxyRestart( sel );
    };

    return (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
            {/* controls */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider", flexWrap: "wrap" }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Local edge (webproxy)</Typography>
                <Chip size="small" variant="outlined" color={running ? "success" : "default"} label={running ? "running :8080" : "stopped"} />

                <Tooltip title="Environment config to run with (--config)">
                    <Select size="small" value={sel} onChange={( e ) => setSel( e.target.value )} sx={{ minWidth: 150 }}>
                        {configs.map( ( c ) => <MenuItem key={c} value={c}>{c}</MenuItem> )}
                    </Select>
                </Tooltip>

                <Box sx={{ flexGrow: 1 }} />

                {running
                    ? <>
                        <Button size="small" variant="outlined" startIcon={<ReplayIcon />} onClick={() => void api.proxyRestart( sel )}>Restart</Button>
                        <Button size="small" color="error" variant="outlined" startIcon={<StopIcon />} onClick={() => void api.proxyStop()}>Stop</Button>
                      </>
                    : <Button size="small" color="success" variant="contained" startIcon={<PlayArrowIcon />} onClick={() => void api.proxyStart( sel )}>Start</Button>}
                <Tooltip title="Open the edge">
                    <span><Button size="small" variant="outlined" startIcon={<OpenInNewIcon />} disabled={!running} onClick={() => void api.openExternal( PROXY_URL )}>:8080</Button></span>
                </Tooltip>
            </Box>

            {/* config editor */}
            <Box sx={{ p: 1.5, borderBottom: "1px solid", borderColor: "divider", maxHeight: "45%", overflow: "auto" }}>
                {err && <Typography variant="caption" sx={{ color: "error.main" }}>{err}</Typography>}
                {cfg && (
                    <>
                        <Typography variant="caption" sx={{ color: "text.disabled", display: "block" }}>
                            SPA root: <span style={{ fontFamily: MONO }}>{cfg.web?.root ?? "—"}</span>{cfg.web?.spaFallback ? " · SPA fallback" : ""}
                        </Typography>
                        <Typography variant="caption" sx={{ color: "text.disabled", fontWeight: 700, display: "block", mt: 1, mb: 0.5 }}>
                            Upstreams — which host each prefix calls
                        </Typography>
                        {cfg.upstreams.map( ( u, i ) => (
                            <Box key={u.name} sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.75 }}>
                                <Box sx={{ width: 110, flexShrink: 0 }}>
                                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{u.name}</Typography>
                                    <Typography variant="caption" sx={{ color: "text.disabled", fontFamily: MONO }}>{u.prefixes.join( " " )}{u.ws ? ` ws:${u.ws}` : ""}</Typography>
                                </Box>
                                <TextField size="small" fullWidth value={u.target}
                                           onChange={( e ) => setTarget( i, e.target.value )}
                                           InputProps={{ sx: { fontFamily: MONO, fontSize: 13 } }} />
                            </Box>
                        ) )}
                        <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
                            <Button size="small" variant="contained" startIcon={<SaveIcon />} disabled={!dirty} onClick={() => void save( false )}>Save</Button>
                            <Button size="small" variant="outlined" startIcon={<SaveIcon />} disabled={!dirty || !running} onClick={() => void save( true )}>Save &amp; restart</Button>
                            {dirty && <Typography variant="caption" sx={{ color: "warning.main", alignSelf: "center" }}>unsaved — writes apps/core/webproxy/src/config/{sel}.json (committed)</Typography>}
                        </Box>
                    </>
                )}
            </Box>

            {/* console output */}
            <Box sx={{ flexGrow: 1, minHeight: 0, overflow: "auto", p: 1, bgcolor: "#0a0d12", fontFamily: MONO, fontSize: 12, lineHeight: 1.5 }}>
                {lines.length === 0
                    ? <Typography variant="caption" sx={{ color: "text.disabled", fontFamily: MONO }}>no output — start the edge</Typography>
                    : lines.map( ( l ) => (
                        <Box key={`${l.stream}-${l.seq}`} component="pre"
                             sx={{ m: 0, whiteSpace: "pre-wrap", wordBreak: "break-word",
                                   color: l.level === "err" ? "#f85149" : l.level === "sys" ? "#8b949e" : "#c9d1d9" }}>
                            {l.text}
                        </Box>
                    ) )}
                <div ref={endRef} />
            </Box>
        </Box>
    );
}
