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
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import CircularProgress from "@mui/material/CircularProgress";
import SendIcon from "@mui/icons-material/Send";
import SaveIcon from "@mui/icons-material/Save";
import DeleteIcon from "@mui/icons-material/DeleteOutline";

import type { ApiEndpointDef, ApiResponse, BuildTarget, KeyVal, SavedRequest, ServiceRole } from "../../shared/types";
import { api } from "../api";
import { loadBuildSettings, saveBuildSettings, BUILD_SETTINGS_EVENT } from "../buildSettings";
import { MONO } from "../theme";

//
// The per-service API tab — a Postman-style client. Endpoints are auto-discovered from @repo/api;
// you build a request (method · port · path · headers · query · body), send it from the main process
// (direct to the service's local port — no CORS), see the response, and save named requests (stored
// in the repo at apps/core/<service>/api-requests.json, so they're shareable + re-runnable).
//

const METHODS : Array<string> = [ "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS" ];

/** A fresh empty key/value row (used as the always-present trailing row in KVEditor). */
const blankRow = () : KeyVal => ( { key: "", value: "", enabled: true } );

// Persisted per-service request draft, so switching tabs/views/services and back keeps the in-progress
// request + last response (transient `sending` is not persisted). localStorage, like the other UI prefs.
interface ApiDraft
{
    method : string; port : number; path : string;
    headers : Array<KeyVal>; query : Array<KeyVal>; body : string;
    reqTab : "params" | "headers" | "body"; respTab : "body" | "headers";
    saveName : string; resp : ApiResponse | null;
}
/** localStorage key for a service's persisted request draft. */
const draftKey  = ( service : string ) : string => `rup.api.${service}`;
/** Read a service's persisted draft (null if absent or unparseable). */
const loadDraft = ( service : string ) : Partial<ApiDraft> | null =>
{
    try { return JSON.parse( localStorage.getItem( draftKey( service ) ) ?? "null" ) as Partial<ApiDraft> | null; }
    catch { return null; }
};
/** Persist a service's request draft (best-effort; ignores quota errors). */
const saveDraft = ( service : string, draft : ApiDraft ) : void =>
{
    try { localStorage.setItem( draftKey( service ), JSON.stringify( draft ) ); } catch { /* quota/ignore */ }
};

/** key/value editor (headers, query) with an always-present trailing blank row. */
function KVEditor( { rows, onChange } : { rows : Array<KeyVal>; onChange : ( next : Array<KeyVal> ) => void } )
{
    const view : Array<KeyVal> = [ ...rows, blankRow() ];
    /** Apply a patch to row `index`, prune emptied-out rows (keeping the trailing blank), and emit. */
    const updateRow = ( index : number, patch : Partial<KeyVal> ) : void =>
    {
        const next : Array<KeyVal> = view.map( ( row, rowIndex ) => ( rowIndex === index ? { ...row, ...patch } : row ) )
            .filter( ( row, rowIndex, allRows ) => row.key !== "" || row.value !== "" || rowIndex === allRows.length - 1 );
        onChange( next.slice( 0, -1 ) );   // drop the trailing blank before storing
    };
    return (
        <Box>
            {view.map( ( row : KeyVal, index : number ) => (
                <Box key={index} sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.25 }}>
                    <Checkbox size="small" checked={row.enabled} onChange={( event ) => updateRow( index, { enabled: event.target.checked } )} sx={{ p: 0.25 }} />
                    <InputBase placeholder="key" value={row.key} onChange={( event ) => updateRow( index, { key: event.target.value } )} sx={{ flex: 1, fontFamily: MONO, fontSize: 12, border: "1px solid", borderColor: "divider", borderRadius: 1, px: 0.75 }} />
                    <InputBase placeholder="value" value={row.value} onChange={( event ) => updateRow( index, { value: event.target.value } )} sx={{ flex: 2, fontFamily: MONO, fontSize: 12, border: "1px solid", borderColor: "divider", borderRadius: 1, px: 0.75 }} />
                </Box>
            ) )}
        </Box>
    );
}

/**
 * The per-service API tab — a Postman-style client: build a request (method · port · path ·
 * headers · query · body), send it via the main process, view the response, and save named
 * requests. The draft persists in localStorage and the send target mirrors the service target.
 */
export function ApiPanel( { service, roles } : { service : string; roles : Array<ServiceRole> } )
{
    const [ endpoints, setEndpoints ] = useState<Array<ApiEndpointDef>>( [] );
    const [ saved, setSaved ]         = useState<Array<SavedRequest>>( [] );

    // restore the persisted draft for this service (ApiPanel remounts on every tab/view/service switch)
    const restored = useMemo<Partial<ApiDraft> | null>( () => loadDraft( service ), [ service ] );

    const [ method, setMethod ] = useState<string>( () => restored?.method ?? "GET" );
    const [ port, setPort ]     = useState<number>( () => restored?.port ?? ( roles[ 0 ]?.port || 8000 ) );
    // where to send mirrors the SERVICE target (Local = the role's own port · LocalStack = the deployed
    // ECS container's published host port). It's the SAME setting as the toolbar's toggle — toggling
    // either updates both (+ the Trace stream), so the API can't drift out of sync with how it runs.
    const [ target, setTarget ]     = useState<BuildTarget>( () => loadBuildSettings( service ).target );
    const [ deployed, setDeployed ] = useState<Record<number, number>>( {} );   // role port → LocalStack host port (fetched live)
    const [ path, setPath ]     = useState<string>( () => restored?.path ?? "/" );
    const [ headers, setHeaders ] = useState<Array<KeyVal>>( () => restored?.headers ?? [] );
    const [ query, setQuery ]     = useState<Array<KeyVal>>( () => restored?.query ?? [] );
    const [ body, setBody ]       = useState<string>( () => restored?.body ?? "" );

    const [ resp, setResp ]       = useState<ApiResponse | null>( () => restored?.resp ?? null );
    const [ sending, setSending ] = useState<boolean>( false );
    const [ reqTab, setReqTab ]   = useState<"params" | "headers" | "body">( () => restored?.reqTab ?? "params" );
    const [ respTab, setRespTab ] = useState<"body" | "headers">( () => restored?.respTab ?? "body" );
    const [ saveName, setSaveName ] = useState<string>( () => restored?.saveName ?? "" );

    // load discovered endpoints + saved requests + live deployed ports (these are fetched, not persisted)
    useEffect( () =>
    {
        let active : boolean = true;
        void api.apiDiscover( service ).then( ( discovered : Array<ApiEndpointDef> ) => { if ( active ) setEndpoints( discovered ); } );
        void api.apiSavedList( service ).then( ( savedRequests : Array<SavedRequest> ) => { if ( active ) setSaved( savedRequests ); } );
        void api.deployedPorts( service ).then( ( ports : Record<number, number> ) => { if ( active ) setDeployed( ports ); } );
        return () => { active = false; };
    }, [ service ] );

    // follow the service target when it's changed elsewhere (the toolbar toggle fires this event)
    useEffect( () =>
    {
        const onBuildSettingsChange = () : void => setTarget( loadBuildSettings( service ).target );
        window.addEventListener( BUILD_SETTINGS_EVENT, onBuildSettingsChange );
        return () => window.removeEventListener( BUILD_SETTINGS_EVENT, onBuildSettingsChange );
    }, [ service ] );

    /** Toggle the target here = change the SERVICE target (so the toolbar + Trace + dots all follow). */
    const changeTarget = ( nextTarget : BuildTarget ) : void =>
    {
        setTarget( nextTarget );
        saveBuildSettings( service, { ...loadBuildSettings( service ), target: nextTarget } );
    };

    // persist the draft on any change → restored on the next mount (ApiPanel is keyed per service upstream)
    useEffect( () =>
    {
        saveDraft( service, { method, port, path, headers, query, body, reqTab, respTab, saveName, resp } );
    }, [ service, method, port, path, headers, query, body, reqTab, respTab, saveName, resp ] );

    const portRoles : Array<ServiceRole> = roles.filter( ( role ) => role.port > 0 );

    // the actual port to hit: Local = the role port; LocalStack = its deployed host port (fallback to role port)
    const effectivePort : number = target === "localstack" ? ( deployed[ port ] ?? port ) : port;

    // Build the full request URL from the effective port, path, and enabled query params.
    const url : string = useMemo<string>( () =>
    {
        const queryString : string = query.filter( ( param ) => param.enabled && param.key ).map( ( param ) => `${encodeURIComponent( param.key )}=${encodeURIComponent( param.value )}` ).join( "&" );
        return `http://localhost:${effectivePort}${path}${queryString ? `?${queryString}` : ""}`;
    }, [ effectivePort, path, query ] );

    /** Load a discovered endpoint into the request builder. */
    const loadEndpoint = ( endpoint : ApiEndpointDef ) : void =>
    {
        setMethod( endpoint.method );
        setPath( endpoint.path );
        if ( endpoint.port ) setPort( endpoint.port );   // jump to the variant this endpoint is registered on
        setResp( null );
    };

    /** Load a saved request into the request builder. */
    const loadSaved = ( savedRequest : SavedRequest ) : void =>
    {
        setMethod( savedRequest.method ); setPort( savedRequest.port ); setPath( savedRequest.path );
        setHeaders( savedRequest.headers ?? [] ); setQuery( savedRequest.query ?? [] ); setBody( savedRequest.body ?? "" );
        setSaveName( savedRequest.name ); setResp( null );
    };

    /** Send the current request via the main process and show the response. */
    const send = async () : Promise<void> =>
    {
        setSending( true );
        try
        {
            const requestHeaders : Record<string, string> = {};
            for ( const header of headers ) if ( header.enabled && header.key ) requestHeaders[ header.key ] = header.value;
            // Default a JSON content-type for bodied methods when the caller didn't set one.
            if ( body && method !== "GET" && method !== "HEAD" && !Object.keys( requestHeaders ).some( ( headerName ) => headerName.toLowerCase() === "content-type" ) )
                requestHeaders[ "content-type" ] = "application/json";
            setResp( await api.apiSend( { method, url, headers: requestHeaders, body: body || undefined } ) );
            setRespTab( "body" );
        }
        finally { setSending( false ); }
    };

    /** Save the current request to the repo under its name (falling back to "METHOD path"). */
    const saveCurrent = async () : Promise<void> =>
    {
        const name : string = saveName.trim() || `${method} ${path}`;
        const request : SavedRequest = {
            id: crypto.randomUUID(), name, endpoint: `${method} ${path}`,
            method, port, path, headers, query, body: body || undefined,
        };
        setSaved( await api.apiSavedSave( service, request ) );
    };

    /** Delete a saved request by id. */
    const remove = async ( id : string ) : Promise<void> => { setSaved( await api.apiSavedDelete( service, id ) ); };

    // Pretty-print the response body when it's valid JSON; otherwise show it as-is.
    const prettyBody : string = useMemo<string>( () =>
    {
        if ( !resp?.body ) return "";
        try { return JSON.stringify( JSON.parse( resp.body ), null, 2 ); }
        catch { return resp.body; }
    }, [ resp ] );

    return (
        <Box sx={{ display: "flex", height: "100%", minHeight: 0 }}>
            {/* left rail: discovered endpoints + saved requests */}
            <Box sx={{ width: 290, flexShrink: 0, borderRight: "1px solid", borderColor: "divider", overflow: "auto", p: 1 }}>
                <Typography variant="caption" sx={{ color: "text.disabled", fontWeight: 700 }}>ENDPOINTS</Typography>
                {endpoints.length === 0 && <Typography variant="caption" sx={{ display: "block", color: "text.disabled" }}>none discovered</Typography>}
                {endpoints.map( ( endpoint : ApiEndpointDef ) => (
                    <Box key={`${endpoint.method} ${endpoint.path}`} onClick={() => loadEndpoint( endpoint )}
                         sx={{ display: "flex", alignItems: "center", gap: 0.5, py: 0.4, px: 0.5, borderRadius: 1, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}>
                        <Box component="span" sx={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, color: methodColor( endpoint.method ), minWidth: 34 }}>{endpoint.method}</Box>
                        <Typography variant="caption" noWrap sx={{ fontFamily: MONO, flex: 1, minWidth: 0 }}>{endpoint.path}</Typography>
                        {endpoint.role && (
                            <Tooltip title={`registered on the ${endpoint.role} variant (:${endpoint.port})`}>
                                <Box component="span" sx={{ fontFamily: MONO, fontSize: 9, color: "text.disabled", border: "1px solid", borderColor: "divider", borderRadius: 1, px: 0.4 }}>{endpoint.role}</Box>
                            </Tooltip>
                        )}
                    </Box>
                ) )}

                <Typography variant="caption" sx={{ color: "text.disabled", fontWeight: 700, display: "block", mt: 1.5 }}>SAVED</Typography>
                {saved.length === 0 && <Typography variant="caption" sx={{ display: "block", color: "text.disabled" }}>none saved</Typography>}
                {saved.map( ( savedRequest : SavedRequest ) => (
                    <Box key={savedRequest.id} sx={{ display: "flex", alignItems: "center", gap: 0.5, py: 0.4, px: 0.5, borderRadius: 1, "&:hover": { bgcolor: "action.hover" } }}>
                        <Box onClick={() => loadSaved( savedRequest )} sx={{ flex: 1, minWidth: 0, cursor: "pointer" }}>
                            <Typography variant="caption" noWrap sx={{ fontWeight: 600, display: "block" }}>{savedRequest.name}</Typography>
                            <Typography variant="caption" noWrap sx={{ fontFamily: MONO, fontSize: 10, color: "text.disabled" }}>{savedRequest.method} :{savedRequest.port}{savedRequest.path}</Typography>
                        </Box>
                        <Tooltip title="Delete saved request"><IconButton size="small" onClick={() => void remove( savedRequest.id )}><DeleteIcon sx={{ fontSize: 15 }} /></IconButton></Tooltip>
                    </Box>
                ) )}
            </Box>

            {/* main: request builder + response */}
            <Box sx={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
                {/* request line */}
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, p: 1, borderBottom: "1px solid", borderColor: "divider" }}>
                    <Select size="small" value={method} onChange={( event ) => setMethod( event.target.value )} sx={{ fontFamily: MONO, fontSize: 12, color: methodColor( method ), fontWeight: 700 }}>
                        {METHODS.map( ( methodOption ) => <MenuItem key={methodOption} value={methodOption} sx={{ fontFamily: MONO, color: methodColor( methodOption ), fontWeight: 700 }}>{methodOption}</MenuItem> )}
                    </Select>
                    <Select size="small" value={port} onChange={( event ) => setPort( Number( event.target.value ) )} sx={{ fontFamily: MONO, fontSize: 12 }}>
                        {portRoles.map( ( role ) => <MenuItem key={role.role} value={role.port} sx={{ fontFamily: MONO }}>{role.role}</MenuItem> )}
                    </Select>
                    {/* Local (role port) vs LocalStack (the deployed container's published host port) */}
                    <ToggleButtonGroup size="small" exclusive value={target} onChange={( _event, nextTarget : BuildTarget | null ) => nextTarget && changeTarget( nextTarget )}>
                        <ToggleButton value="local" sx={{ px: 1, py: 0.2, fontSize: 11 }}>Local</ToggleButton>
                        <Tooltip title={deployed[ port ] ? `deployed at :${deployed[ port ]}` : "no deployed container found — deploy to LocalStack"}>
                            <span><ToggleButton value="localstack" sx={{ px: 1, py: 0.2, fontSize: 11 }}>LocalStack</ToggleButton></span>
                        </Tooltip>
                    </ToggleButtonGroup>
                    <InputBase value={path} onChange={( event ) => setPath( event.target.value )} placeholder="/path"
                               sx={{ flex: 1, fontFamily: MONO, fontSize: 13, border: "1px solid", borderColor: "divider", borderRadius: 1, px: 1 }} />
                    <Button variant="contained" startIcon={sending ? <CircularProgress size={14} color="inherit" /> : <SendIcon />} disabled={sending} onClick={() => void send()}>Send</Button>
                </Box>

                {/* full URL preview + save */}
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, px: 1, py: 0.5, borderBottom: "1px solid", borderColor: "divider", bgcolor: "background.paper" }}>
                    <Typography variant="caption" noWrap sx={{ flex: 1, fontFamily: MONO, color: "text.disabled" }}>{url}</Typography>
                    <InputBase value={saveName} onChange={( event ) => setSaveName( event.target.value )} placeholder="save as…" sx={{ width: 130, fontSize: 12, border: "1px solid", borderColor: "divider", borderRadius: 1, px: 0.75 }} />
                    <Tooltip title="Save this request (to the repo)"><IconButton size="small" onClick={() => void saveCurrent()}><SaveIcon fontSize="small" /></IconButton></Tooltip>
                </Box>

                {/* request editor tabs */}
                <Tabs value={reqTab} onChange={( _event, nextTab ) => setReqTab( nextTab )} sx={{ minHeight: 34, "& .MuiTab-root": { minHeight: 34, py: 0, fontSize: 12 } }}>
                    <Tab value="params" label={`Params${query.filter( ( param ) => param.key ).length ? ` (${query.filter( ( param ) => param.key ).length})` : ""}`} />
                    <Tab value="headers" label={`Headers${headers.filter( ( header ) => header.key ).length ? ` (${headers.filter( ( header ) => header.key ).length})` : ""}`} />
                    <Tab value="body" label="Body" />
                </Tabs>
                <Box sx={{ p: 1, borderBottom: "1px solid", borderColor: "divider", maxHeight: 170, overflow: "auto" }}>
                    {reqTab === "params" && <KVEditor rows={query} onChange={setQuery} />}
                    {reqTab === "headers" && <KVEditor rows={headers} onChange={setHeaders} />}
                    {reqTab === "body" && (
                        <TextField value={body} onChange={( event ) => setBody( event.target.value )} placeholder="request body (JSON)" multiline minRows={4} fullWidth
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
                                    <Tabs value={respTab} onChange={( _event, nextTab ) => setRespTab( nextTab )} sx={{ minHeight: 30, "& .MuiTab-root": { minHeight: 30, py: 0, fontSize: 11 } }}>
                                        <Tab value="body" label="Body" />
                                        <Tab value="headers" label={`Headers (${Object.keys( resp.headers ).length})`} />
                                    </Tabs>
                                </Box>
                                <Box sx={{ flexGrow: 1, minHeight: 0, overflow: "auto", bgcolor: "#0a0d12", p: 1 }}>
                                    {resp.error
                                        ? <Typography variant="caption" sx={{ color: "error.main", fontFamily: MONO }}>{resp.error}</Typography>
                                        : respTab === "body"
                                            ? <Box component="pre" sx={{ m: 0, fontFamily: MONO, fontSize: 12, color: "#c9d1d9", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{prettyBody || "(empty)"}</Box>
                                            : <Box>{Object.entries( resp.headers ).map( ( [ headerName, headerValue ] ) => (
                                                  <Box key={headerName} sx={{ display: "flex", gap: 1, fontFamily: MONO, fontSize: 11.5 }}>
                                                      <Box component="span" sx={{ color: "#79c0ff", minWidth: 160 }}>{headerName}</Box>
                                                      <Box component="span" sx={{ color: "text.secondary", wordBreak: "break-all" }}>{headerValue}</Box>
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

/** Accent color for an HTTP method label. */
function methodColor( method : string ) : string
{
    switch ( method )
    {
        case "GET":    return "#3fb950";
        case "POST":   return "#d29922";
        case "PUT":    return "#58a6ff";
        case "PATCH":  return "#b07cff";
        case "DELETE": return "#f85149";
        default:        return "#8b949e";
    }
}

/** Format a byte count as a human-readable size (B / KB / MB). */
function humanSize( bytes : number ) : string
{
    if ( bytes < 1024 ) return `${bytes} B`;
    if ( bytes < 1024 * 1024 ) return `${( bytes / 1024 ).toFixed( 1 )} KB`;
    return `${( bytes / 1024 / 1024 ).toFixed( 1 )} MB`;
}
