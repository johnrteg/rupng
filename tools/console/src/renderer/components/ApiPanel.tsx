import { useEffect, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import InputBase from "@mui/material/InputBase";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import Checkbox from "@mui/material/Checkbox";
import CircularProgress from "@mui/material/CircularProgress";
import SendIcon from "@mui/icons-material/Send";
import SaveIcon from "@mui/icons-material/Save";
import DeleteIcon from "@mui/icons-material/DeleteOutline";

import type { ApiEndpointDef, ApiResponse, KeyVal, SavedRequest, ServiceRole } from "../../shared/types";
import { api } from "../api";
import { MONO } from "../theme";

//
// The per-service API tab — a Postman-style client. Endpoints are auto-discovered from @repo/api;
// you build a request (method · port · path · headers · query · body), send it from the main process
// (direct to the service's local port — no CORS), see the response, and save named requests (stored
// in the repo at apps/core/<service>/api-requests.json, so they're shareable + re-runnable).
//

const METHODS : string[] = [ "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS" ];

const blankRow = () : KeyVal => ( { key: "", value: "", enabled: true } );

/** key/value editor (headers, query) with an always-present trailing blank row. */
function KVEditor( { rows, onChange } : { rows : KeyVal[]; onChange : ( next : KeyVal[] ) => void } )
{
    const view : KeyVal[] = [ ...rows, blankRow() ];
    const set = ( i : number, patch : Partial<KeyVal> ) : void =>
    {
        const next : KeyVal[] = view.map( ( r, idx ) => ( idx === i ? { ...r, ...patch } : r ) )
            .filter( ( r, idx, arr ) => r.key !== "" || r.value !== "" || idx === arr.length - 1 );
        onChange( next.slice( 0, -1 ) );   // drop the trailing blank before storing
    };
    return (
        <Box>
            {view.map( ( r : KeyVal, i : number ) => (
                <Box key={i} sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.25 }}>
                    <Checkbox size="small" checked={r.enabled} onChange={( e ) => set( i, { enabled: e.target.checked } )} sx={{ p: 0.25 }} />
                    <InputBase placeholder="key" value={r.key} onChange={( e ) => set( i, { key: e.target.value } )} sx={{ flex: 1, fontFamily: MONO, fontSize: 12, border: "1px solid", borderColor: "divider", borderRadius: 1, px: 0.75 }} />
                    <InputBase placeholder="value" value={r.value} onChange={( e ) => set( i, { value: e.target.value } )} sx={{ flex: 2, fontFamily: MONO, fontSize: 12, border: "1px solid", borderColor: "divider", borderRadius: 1, px: 0.75 }} />
                </Box>
            ) )}
        </Box>
    );
}

export function ApiPanel( { service, roles } : { service : string; roles : ServiceRole[] } )
{
    const [ endpoints, setEndpoints ] = useState<ApiEndpointDef[]>( [] );
    const [ saved, setSaved ]         = useState<SavedRequest[]>( [] );

    const [ method, setMethod ] = useState<string>( "GET" );
    const [ port, setPort ]     = useState<number>( roles[ 0 ]?.port || 8000 );
    const [ path, setPath ]     = useState<string>( "/" );
    const [ headers, setHeaders ] = useState<KeyVal[]>( [] );
    const [ query, setQuery ]     = useState<KeyVal[]>( [] );
    const [ body, setBody ]       = useState<string>( "" );

    const [ resp, setResp ]       = useState<ApiResponse | null>( null );
    const [ sending, setSending ] = useState<boolean>( false );
    const [ reqTab, setReqTab ]   = useState<"params" | "headers" | "body">( "params" );
    const [ respTab, setRespTab ] = useState<"body" | "headers">( "body" );
    const [ saveName, setSaveName ] = useState<string>( "" );

    // load discovered endpoints + saved requests when the service changes
    useEffect( () =>
    {
        let active : boolean = true;
        void api.apiDiscover( service ).then( ( e : ApiEndpointDef[] ) => { if ( active ) setEndpoints( e ); } );
        void api.apiSavedList( service ).then( ( s : SavedRequest[] ) => { if ( active ) setSaved( s ); } );
        setResp( null );
        return () => { active = false; };
    }, [ service ] );

    const portRoles : ServiceRole[] = roles.filter( ( r ) => r.port > 0 );

    const url : string = useMemo<string>( () =>
    {
        const qs : string = query.filter( ( q ) => q.enabled && q.key ).map( ( q ) => `${encodeURIComponent( q.key )}=${encodeURIComponent( q.value )}` ).join( "&" );
        return `http://localhost:${port}${path}${qs ? `?${qs}` : ""}`;
    }, [ port, path, query ] );

    const loadEndpoint = ( ep : ApiEndpointDef ) : void =>
    {
        setMethod( ep.method );
        setPath( ep.path );
        if ( ep.port ) setPort( ep.port );   // jump to the variant this endpoint is registered on
        setResp( null );
    };

    const loadSaved = ( r : SavedRequest ) : void =>
    {
        setMethod( r.method ); setPort( r.port ); setPath( r.path );
        setHeaders( r.headers ?? [] ); setQuery( r.query ?? [] ); setBody( r.body ?? "" );
        setSaveName( r.name ); setResp( null );
    };

    const send = async () : Promise<void> =>
    {
        setSending( true );
        try
        {
            const hdrs : Record<string, string> = {};
            for ( const h of headers ) if ( h.enabled && h.key ) hdrs[ h.key ] = h.value;
            if ( body && method !== "GET" && method !== "HEAD" && !Object.keys( hdrs ).some( ( k ) => k.toLowerCase() === "content-type" ) )
                hdrs[ "content-type" ] = "application/json";
            setResp( await api.apiSend( { method, url, headers: hdrs, body: body || undefined } ) );
            setRespTab( "body" );
        }
        finally { setSending( false ); }
    };

    const saveCurrent = async () : Promise<void> =>
    {
        const name : string = saveName.trim() || `${method} ${path}`;
        const req : SavedRequest = {
            id: crypto.randomUUID(), name, endpoint: `${method} ${path}`,
            method, port, path, headers, query, body: body || undefined,
        };
        setSaved( await api.apiSavedSave( service, req ) );
    };

    const remove = async ( id : string ) : Promise<void> => { setSaved( await api.apiSavedDelete( service, id ) ); };

    const prettyBody : string = useMemo<string>( () =>
    {
        if ( !resp?.body ) return "";
        try { return JSON.stringify( JSON.parse( resp.body ), null, 2 ); }
        catch { return resp.body; }
    }, [ resp ] );

    return (
        <Box sx={{ display: "flex", height: "100%", minHeight: 0 }}>
            {/* left rail: discovered endpoints + saved requests */}
            <Box sx={{ width: 240, flexShrink: 0, borderRight: "1px solid", borderColor: "divider", overflow: "auto", p: 1 }}>
                <Typography variant="caption" sx={{ color: "text.disabled", fontWeight: 700 }}>ENDPOINTS</Typography>
                {endpoints.length === 0 && <Typography variant="caption" sx={{ display: "block", color: "text.disabled" }}>none discovered</Typography>}
                {endpoints.map( ( ep : ApiEndpointDef ) => (
                    <Box key={`${ep.method} ${ep.path}`} onClick={() => loadEndpoint( ep )}
                         sx={{ display: "flex", alignItems: "center", gap: 0.5, py: 0.4, px: 0.5, borderRadius: 1, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}>
                        <Box component="span" sx={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, color: methodColor( ep.method ), minWidth: 34 }}>{ep.method}</Box>
                        <Typography variant="caption" noWrap sx={{ fontFamily: MONO, flex: 1, minWidth: 0 }}>{ep.path}</Typography>
                        {ep.role && (
                            <Tooltip title={`registered on the ${ep.role} variant (:${ep.port})`}>
                                <Box component="span" sx={{ fontFamily: MONO, fontSize: 9, color: "text.disabled", border: "1px solid", borderColor: "divider", borderRadius: 1, px: 0.4 }}>{ep.role}</Box>
                            </Tooltip>
                        )}
                    </Box>
                ) )}

                <Typography variant="caption" sx={{ color: "text.disabled", fontWeight: 700, display: "block", mt: 1.5 }}>SAVED</Typography>
                {saved.length === 0 && <Typography variant="caption" sx={{ display: "block", color: "text.disabled" }}>none saved</Typography>}
                {saved.map( ( r : SavedRequest ) => (
                    <Box key={r.id} sx={{ display: "flex", alignItems: "center", gap: 0.5, py: 0.4, px: 0.5, borderRadius: 1, "&:hover": { bgcolor: "action.hover" } }}>
                        <Box onClick={() => loadSaved( r )} sx={{ flex: 1, minWidth: 0, cursor: "pointer" }}>
                            <Typography variant="caption" noWrap sx={{ fontWeight: 600, display: "block" }}>{r.name}</Typography>
                            <Typography variant="caption" noWrap sx={{ fontFamily: MONO, fontSize: 10, color: "text.disabled" }}>{r.method} :{r.port}{r.path}</Typography>
                        </Box>
                        <Tooltip title="Delete saved request"><IconButton size="small" onClick={() => void remove( r.id )}><DeleteIcon sx={{ fontSize: 15 }} /></IconButton></Tooltip>
                    </Box>
                ) )}
            </Box>

            {/* main: request builder + response */}
            <Box sx={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
                {/* request line */}
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, p: 1, borderBottom: "1px solid", borderColor: "divider" }}>
                    <Select size="small" value={method} onChange={( e ) => setMethod( e.target.value )} sx={{ fontFamily: MONO, fontSize: 12, color: methodColor( method ), fontWeight: 700 }}>
                        {METHODS.map( ( m ) => <MenuItem key={m} value={m} sx={{ fontFamily: MONO, color: methodColor( m ), fontWeight: 700 }}>{m}</MenuItem> )}
                    </Select>
                    <Tooltip title="Service port (direct)">
                        <Select size="small" value={port} onChange={( e ) => setPort( Number( e.target.value ) )} sx={{ fontFamily: MONO, fontSize: 12 }}>
                            {portRoles.map( ( r ) => <MenuItem key={r.role} value={r.port} sx={{ fontFamily: MONO }}>:{r.port} {r.role}</MenuItem> )}
                        </Select>
                    </Tooltip>
                    <InputBase value={path} onChange={( e ) => setPath( e.target.value )} placeholder="/path"
                               sx={{ flex: 1, fontFamily: MONO, fontSize: 13, border: "1px solid", borderColor: "divider", borderRadius: 1, px: 1 }} />
                    <Button variant="contained" startIcon={sending ? <CircularProgress size={14} color="inherit" /> : <SendIcon />} disabled={sending} onClick={() => void send()}>Send</Button>
                </Box>

                {/* full URL preview + save */}
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, px: 1, py: 0.5, borderBottom: "1px solid", borderColor: "divider", bgcolor: "background.paper" }}>
                    <Typography variant="caption" noWrap sx={{ flex: 1, fontFamily: MONO, color: "text.disabled" }}>{url}</Typography>
                    <InputBase value={saveName} onChange={( e ) => setSaveName( e.target.value )} placeholder="save as…" sx={{ width: 130, fontSize: 12, border: "1px solid", borderColor: "divider", borderRadius: 1, px: 0.75 }} />
                    <Tooltip title="Save this request (to the repo)"><IconButton size="small" onClick={() => void saveCurrent()}><SaveIcon fontSize="small" /></IconButton></Tooltip>
                </Box>

                {/* request editor tabs */}
                <Tabs value={reqTab} onChange={( _e, v ) => setReqTab( v )} sx={{ minHeight: 34, "& .MuiTab-root": { minHeight: 34, py: 0, fontSize: 12 } }}>
                    <Tab value="params" label={`Params${query.filter( ( q ) => q.key ).length ? ` (${query.filter( ( q ) => q.key ).length})` : ""}`} />
                    <Tab value="headers" label={`Headers${headers.filter( ( h ) => h.key ).length ? ` (${headers.filter( ( h ) => h.key ).length})` : ""}`} />
                    <Tab value="body" label="Body" />
                </Tabs>
                <Box sx={{ p: 1, borderBottom: "1px solid", borderColor: "divider", maxHeight: 170, overflow: "auto" }}>
                    {reqTab === "params" && <KVEditor rows={query} onChange={setQuery} />}
                    {reqTab === "headers" && <KVEditor rows={headers} onChange={setHeaders} />}
                    {reqTab === "body" && (
                        <TextField value={body} onChange={( e ) => setBody( e.target.value )} placeholder="request body (JSON)" multiline minRows={4} fullWidth
                                   slotProps={{ htmlInput: { style: { fontFamily: MONO, fontSize: 12 } } }} />
                    )}
                </Box>

                {/* response */}
                <Box sx={{ flexGrow: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                    {!resp
                        ? <Box sx={{ display: "grid", placeItems: "center", flexGrow: 1 }}><Typography variant="caption" sx={{ color: "text.disabled" }}>send a request to see the response</Typography></Box>
                        : (
                            <>
                                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 1, py: 0.5, borderBottom: "1px solid", borderColor: "divider" }}>
                                    <Chip size="small" color={resp.error ? "error" : resp.ok ? "success" : "warning"} label={resp.error ? "error" : `${resp.status} ${resp.statusText}`} />
                                    {!resp.error && <Typography variant="caption" sx={{ color: "text.disabled" }}>{resp.timeMs} ms · {humanSize( resp.size )}</Typography>}
                                    <Box sx={{ flexGrow: 1 }} />
                                    <Tabs value={respTab} onChange={( _e, v ) => setRespTab( v )} sx={{ minHeight: 30, "& .MuiTab-root": { minHeight: 30, py: 0, fontSize: 11 } }}>
                                        <Tab value="body" label="Body" />
                                        <Tab value="headers" label={`Headers (${Object.keys( resp.headers ).length})`} />
                                    </Tabs>
                                </Box>
                                <Box sx={{ flexGrow: 1, minHeight: 0, overflow: "auto", bgcolor: "#0a0d12", p: 1 }}>
                                    {resp.error
                                        ? <Typography variant="caption" sx={{ color: "error.main", fontFamily: MONO }}>{resp.error}</Typography>
                                        : respTab === "body"
                                            ? <Box component="pre" sx={{ m: 0, fontFamily: MONO, fontSize: 12, color: "#c9d1d9", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{prettyBody || "(empty)"}</Box>
                                            : <Box>{Object.entries( resp.headers ).map( ( [ k, v ] ) => (
                                                  <Box key={k} sx={{ display: "flex", gap: 1, fontFamily: MONO, fontSize: 11.5 }}>
                                                      <Box component="span" sx={{ color: "#79c0ff", minWidth: 160 }}>{k}</Box>
                                                      <Box component="span" sx={{ color: "text.secondary", wordBreak: "break-all" }}>{v}</Box>
                                                  </Box>
                                              ) )}</Box>}
                                </Box>
                            </>
                        )}
                </Box>
            </Box>
        </Box>
    );
}

function methodColor( m : string ) : string
{
    switch ( m )
    {
        case "GET":    return "#3fb950";
        case "POST":   return "#d29922";
        case "PUT":    return "#58a6ff";
        case "PATCH":  return "#b07cff";
        case "DELETE": return "#f85149";
        default:        return "#8b949e";
    }
}

function humanSize( n : number ) : string
{
    if ( n < 1024 ) return `${n} B`;
    if ( n < 1024 * 1024 ) return `${( n / 1024 ).toFixed( 1 )} KB`;
    return `${( n / 1024 / 1024 ).toFixed( 1 )} MB`;
}
