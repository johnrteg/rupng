import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dagre from "@dagrejs/dagre";
import { SparkLineChart } from "@mui/x-charts/SparkLineChart";
import { PieChart } from "@mui/x-charts/PieChart";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import Tooltip from "@mui/material/Tooltip";
import IconButton from "@mui/material/IconButton";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import CircularProgress from "@mui/material/CircularProgress";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import SchemaIcon from "@mui/icons-material/Schema";
import ViewListIcon from "@mui/icons-material/ViewList";
import TroubleshootIcon from "@mui/icons-material/Troubleshoot";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import RefreshIcon from "@mui/icons-material/Refresh";
import CenterFocusStrongIcon from "@mui/icons-material/CenterFocusStrong";
import ArticleIcon from "@mui/icons-material/Article";
import CloseIcon from "@mui/icons-material/Close";
import FolderIcon from "@mui/icons-material/Folder";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";

import type { ApiGwInfo, ClockSkew, CloudCategory, CloudEdge, CloudGraph, CloudHealth, CloudNode, ContainerInfo, DiagFinding, DiagLevel, EcsServiceState, LogEvent, RouteTest, S3Listing, TargetInfo, VpcLinkDiagnosis } from "../../shared/types";
import { TargetKind } from "../../shared/types";
import { api } from "../api";
import { useMetrics, type MetricHistory } from "../metricsStore";
import { targetStore, useTarget } from "../targetStore";
import { awsStyle } from "../awsIcons";
import { ArchView } from "./ArchView";
import { useSettings, type HistogramWindowMin } from "../settingsStore";
import { MONO } from "../theme";

//
// The "Monitor" tab — LocalStack observability. Pulls the deployed CloudFormation graph (nodes =
// resources, edges = template references), lays it out with dagre, and renders it as pan/zoom SVG.
// Click a node for its details + CloudWatch log tail. A header strip shows /_localstack/health.
//

const CATEGORY_COLOR : Record<CloudCategory, string> =
{
    edge          : "#5b9dff",
    network       : "#79c0ff",
    compute       : "#3fb950",
    messaging     : "#d29922",
    data          : "#b07cff",
    identity      : "#f0883e",
    observability : "#8b949e",
    other         : "#6e7681"
};

const CATEGORY_LABEL : Record<CloudCategory, string> =
{
    edge: "Edge", network: "Network", compute: "Compute", messaging: "Messaging",
    data: "Data", identity: "Identity", observability: "Observability", other: "Other"
};

const NODE_W = 204;
const NODE_H = 50;

// clock-skew thresholds (seconds): amber past WARN, red past FAIL (TOTP's ±30s window is the hard wall)
const CLOCK_WARN_SEC = 10;
const CLOCK_FAIL_SEC = 30;

/** Header badge: host↔LocalStack clock skew. Hidden off-LocalStack / until the first sample lands. */
function ClockSkewChip( { clock } : { clock : ClockSkew | null } ) : ReactNode
{
    if ( !clock ) return null;

    if ( !clock.ok )
        return (
            <Tooltip title={clock.detail ?? "clock unavailable"}>
                <Chip size="small" variant="outlined" label="clock —" sx={{ color: "text.disabled" }} />
            </Tooltip>
        );

    const skew : number = clock.skewSec ?? 0;
    const abs  : number = Math.abs( skew );
    const color : "success" | "warning" | "error" = abs >= CLOCK_FAIL_SEC ? "error" : abs >= CLOCK_WARN_SEC ? "warning" : "success";
    const sign : string = skew >= 0 ? "+" : "-";
    const hint : string = abs >= CLOCK_FAIL_SEC
        ? "Time-based codes (TOTP MFA) will fail. Restart Docker Desktop to resync the VM clock."
        : abs >= CLOCK_WARN_SEC
            ? "Approaching the ±30s TOTP window — consider restarting Docker Desktop."
            : "Within the ±30s TOTP window.";

    return (
        <Tooltip title={`Host ↔ ${clock.container ?? "LocalStack"} clock differ by ${sign}${abs}s.\n${hint}`}>
            <Chip size="small" color={color} variant={abs >= CLOCK_FAIL_SEC ? "filled" : "outlined"} label={`clock ${sign}${abs}s`} />
        </Tooltip>
    );
}

interface ViewTransform { tx : number; ty : number; scale : number; }

interface Placed { node : CloudNode; x : number; y : number; }
interface Laid { placed : Array<Placed>; edges : { points : { x : number; y : number }[] }[]; width : number; height : number; }

/** Lay out the raw reference graph left-to-right with dagre, returning placed nodes + routed edges. */
function layout( graph : CloudGraph ) : Laid
{
    // `graphLayout`/`graphLabel`/the edge param are left inferred: dagre's Graph is generic and
    // annotating it as Graph<unknown,…> fights dagre.layout's GraphLabel constraint. Inference yields
    // the correct types.
    const graphLayout = new dagre.graphlib.Graph();
    graphLayout.setGraph( { rankdir: "LR", nodesep: 26, ranksep: 70, marginx: 24, marginy: 24 } );
    graphLayout.setDefaultEdgeLabel( () => ( {} ) );

    const ids : Set<string> = new Set( graph.nodes.map( ( node ) => node.id ) );
    for ( const node of graph.nodes ) graphLayout.setNode( node.id, { width: NODE_W, height: NODE_H } );
    for ( const edge of graph.edges ) if ( ids.has( edge.from ) && ids.has( edge.to ) ) graphLayout.setEdge( edge.from, edge.to );

    dagre.layout( graphLayout );

    const placed : Array<Placed> = graph.nodes.map( ( node : CloudNode ) : Placed =>
    {
        const placement : { x : number; y : number } | undefined = graphLayout.node( node.id ) as { x : number; y : number } | undefined;
        return { node, x: placement?.x ?? 0, y: placement?.y ?? 0 };
    } );

    const edges : Laid[ "edges" ] = graphLayout.edges().map( ( edge ) =>
    {
        const points : { x : number; y : number }[] = ( graphLayout.edge( edge ) as { points? : { x : number; y : number }[] } ).points ?? [];
        return { points };
    } );

    const graphLabel = graphLayout.graph();
    return { placed, edges, width: graphLabel.width ?? 1000, height: graphLabel.height ?? 600 };
}

/** The Monitor tab — LocalStack/AWS observability: graph, architecture, containers, and diagnose views. */
export function CloudView()
{
    const [ graph, setGraph ]     = useState<CloudGraph | null>( null );
    const [ health, setHealth ]   = useState<CloudHealth | null>( null );
    const [ clock, setClock ]     = useState<ClockSkew | null>( null );   // host↔container clock (LocalStack only)
    const [ loading, setLoading ] = useState<boolean>( false );
    const [ selectedId, setSelectedId ] = useState<string | null>( null );

    const [ mode, setMode ] = useState<"graph" | "architecture" | "containers" | "diagnose">( "architecture" );
    const [ view, setView ] = useState<ViewTransform>( { tx: 24, ty: 24, scale: 0.85 } );
    const drag = useRef<{ x : number; y : number; moved : boolean } | null>( null );
    const svgRef = useRef<SVGSVGElement | null>( null );

    /** Pull the CloudFormation graph + LocalStack health together, toggling the loading flag. */
    const refresh = useCallback( async () : Promise<void> =>
    {
        setLoading( true );
        try { const [ nextGraph, nextHealth ] = await Promise.all( [ api.cloudGraph(), api.cloudHealth() ] ); setGraph( nextGraph ); setHealth( nextHealth ); }
        finally { setLoading( false ); }
    }, [] );

    // refresh the graph + health when the view opens AND whenever the target (LocalStack/AWS) changes
    const targetInfo : TargetInfo = useTarget();
    useEffect( () => { void refresh(); }, [ refresh, targetInfo.target.kind, targetInfo.target.profile, targetInfo.target.region ] );
    // poll health on a 15s interval so the status strip stays current without a full graph refresh
    useEffect( () => { const intervalId = setInterval( () => { void api.cloudHealth().then( setHealth ); }, 15000 ); return () => clearInterval( intervalId ); }, [] );
    // clock-skew check — LocalStack only (a real AWS target has no container to exec). Drift here silently
    // breaks time-based codes (TOTP MFA, ±30s), so surface it. Poll every 30s.
    useEffect( () =>
    {
        if ( targetInfo.target.kind !== TargetKind.LOCALSTACK ) { setClock( null ); return; }
        const tick = () : void => { void api.localstackClockSkew().then( setClock ); };
        tick();
        const intervalId = setInterval( tick, 30000 );
        return () => clearInterval( intervalId );
    }, [ targetInfo.target.kind ] );

    const [ cats, setCats ] = useState<Set<CloudCategory>>( new Set() );
    /** Toggle a category in/out of the active filter set. */
    const toggleCat = ( category : CloudCategory ) : void =>
        setCats( ( prev ) => { const next = new Set( prev ); next.has( category ) ? next.delete( category ) : next.add( category ); return next; } );

    // per-category node counts (over the full graph), used for the toolbar filter chips
    const catCounts : Record<CloudCategory, number> = useMemo<Record<CloudCategory, number>>( () =>
    {
        const counts : Record<CloudCategory, number> = {} as Record<CloudCategory, number>;
        for ( const node of graph?.nodes ?? [] ) counts[ node.category ] = ( counts[ node.category ] ?? 0 ) + 1;
        return counts;
    }, [ graph ] );

    // graph filtered to the selected categories (empty selection = show all)
    const visible = useMemo<CloudGraph | null>( () =>
    {
        if ( !graph ) return null;
        if ( cats.size === 0 ) return graph;
        const nodes : Array<CloudNode> = graph.nodes.filter( ( node ) => cats.has( node.category ) );
        const ids : Set<string> = new Set( nodes.map( ( node ) => node.id ) );
        const edges : Array<CloudEdge> = graph.edges.filter( ( edge ) => ids.has( edge.from ) && ids.has( edge.to ) );
        return { ...graph, nodes, edges };
    }, [ graph, cats ] );

    const laid : Laid | null = useMemo<Laid | null>( () => ( visible ? layout( visible ) : null ), [ visible ] );
    const selected : CloudNode | null = useMemo<CloudNode | null>( () => graph?.nodes.find( ( node ) => node.id === selectedId ) ?? null, [ graph, selectedId ] );

    // pan / zoom
    /** Zoom toward the cursor: keep the world point under the pointer fixed as scale changes. */
    const onWheel = ( event : React.WheelEvent ) : void =>
    {
        const rect : DOMRect | undefined = svgRef.current?.getBoundingClientRect();
        if ( !rect ) return;
        const cursorX : number = event.clientX - rect.left, cursorY : number = event.clientY - rect.top;
        setView( ( prev : ViewTransform ) : ViewTransform =>
        {
            const next : number = Math.min( 2.5, Math.max( 0.2, prev.scale * ( event.deltaY < 0 ? 1.1 : 0.9 ) ) );
            // world coords under the cursor before zoom — re-anchor the translation so they stay put
            const worldX : number = ( cursorX - prev.tx ) / prev.scale, worldY : number = ( cursorY - prev.ty ) / prev.scale;
            return { scale: next, tx: cursorX - worldX * next, ty: cursorY - worldY * next };
        } );
    };
    const onDown = ( event : React.MouseEvent ) : void => { drag.current = { x: event.clientX, y: event.clientY, moved: false }; };
    /** Pan by the pointer delta; flag `moved` past a small threshold so a drag isn't read as a click. */
    const onMove = ( event : React.MouseEvent ) : void =>
    {
        if ( !drag.current ) return;
        const deltaX : number = event.clientX - drag.current.x, deltaY : number = event.clientY - drag.current.y;
        if ( Math.abs( deltaX ) + Math.abs( deltaY ) > 3 ) drag.current.moved = true;
        drag.current.x = event.clientX; drag.current.y = event.clientY;
        setView( ( prev ) => ( { ...prev, tx: prev.tx + deltaX, ty: prev.ty + deltaY } ) );
    };
    const onUp = () : void => { drag.current = null; };
    /** Reset pan + zoom to the default framing. */
    const fit = () : void => setView( { tx: 24, ty: 24, scale: 0.85 } );

    const runningServices : Array<[ string, string ]> = health ? globalThis.Object.entries( health.services ).filter( ( [ , status ] ) => status === "running" || status === "available" ) : [];

    return (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
            {/* health / status strip */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 0.75, borderBottom: "1px solid", borderColor: "divider", flexWrap: "wrap" }}>
                <TargetSelector />
                <Chip color={health?.reachable ? "success" : "error"} variant={health?.reachable ? "filled" : "outlined"}
                      label={health?.reachable ? `LocalStack reachable${health.edition ? ` · ${health.edition}` : ""}` : "LocalStack unreachable"} />
                {health?.reachable && (
                    <Tooltip title={runningServices.map( ( [ name, status ] ) => `${name}: ${status}` ).join( "\n" ) || "no services reported"}>
                        <Chip variant="outlined" label={`${runningServices.length} services up`} />
                    </Tooltip>
                )}
                <ClockSkewChip clock={clock} />
                {graph && <Chip variant="outlined" label={`${graph.stacks.length} stacks`} />}
                {graph && <Chip variant="outlined" label={`${graph.nodes.length} resources`} />}
                <Box sx={{ flexGrow: 1 }} />
                <ToggleButtonGroup size="small" exclusive value={mode} onChange={( _event, nextMode ) => nextMode && setMode( nextMode )}>
                    <ToggleButton value="architecture" sx={{ px: 1.25 }}><SchemaIcon fontSize="small" sx={{ mr: 0.5 }} />Architecture</ToggleButton>
                    <ToggleButton value="graph" sx={{ px: 1.25 }}><AccountTreeIcon fontSize="small" sx={{ mr: 0.5 }} />Graph</ToggleButton>
                    <ToggleButton value="containers" sx={{ px: 1.25 }}><ViewListIcon fontSize="small" sx={{ mr: 0.5 }} />Containers</ToggleButton>
                    <ToggleButton value="diagnose" sx={{ px: 1.25 }}><TroubleshootIcon fontSize="small" sx={{ mr: 0.5 }} />Diagnose</ToggleButton>
                </ToggleButtonGroup>
                {mode === "graph" && <Tooltip title="Reset view"><IconButton size="small" onClick={fit}><CenterFocusStrongIcon fontSize="small" /></IconButton></Tooltip>}
                {( mode === "graph" || mode === "architecture" ) && <Button size="small" variant="outlined" startIcon={loading ? <CircularProgress size={13} /> : <RefreshIcon fontSize="small" />} onClick={() => void refresh()}>Refresh</Button>}
            </Box>

            {/* category filter (the interactive legend) */}
            {mode === "graph" && graph && graph.nodes.length > 0 && (
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, px: 1.5, py: 0.6, borderBottom: "1px solid", borderColor: "divider", flexWrap: "wrap", bgcolor: "background.paper" }}>
                    <Typography variant="caption" sx={{ color: "text.disabled", mr: 0.5 }}>{cats.size === 0 ? "showing all" : "filter:"}</Typography>
                    {( globalThis.Object.keys( CATEGORY_LABEL ) as Array<CloudCategory> )
                        .filter( ( category ) => ( catCounts[ category ] ?? 0 ) > 0 )
                        .map( ( category ) =>
                        {
                            const active : boolean = cats.has( category );
                            return (
                                <Chip
                                    key={category}
                                    onClick={() => toggleCat( category )}
                                    variant={active ? "filled" : "outlined"}
                                    label={`${CATEGORY_LABEL[ category ]} ${catCounts[ category ]}`}
                                    sx={{
                                        cursor      : "pointer",
                                        borderColor : CATEGORY_COLOR[ category ],
                                        color       : active ? "#0d1117" : CATEGORY_COLOR[ category ],
                                        bgcolor     : active ? CATEGORY_COLOR[ category ] : "transparent",
                                        fontWeight  : 600,
                                        "& .MuiChip-label": { px: 1 }
                                    }}
                                />
                            );
                        } )}
                    {cats.size > 0 && <Button size="small" sx={{ minWidth: 0 }} onClick={() => setCats( new Set() )}>clear</Button>}
                </Box>
            )}

            {/* graph + detail */}
            {mode === "containers"
                ? <ContainersPanel />
                : mode === "diagnose"
                ? <DiagnosePanel />
                : mode === "architecture"
                ? <Box sx={{ display: "flex", flexGrow: 1, minHeight: 0 }}>
                    <Box sx={{ position: "relative", flexGrow: 1, minWidth: 0, bgcolor: "#0a0d12" }}>
                        {graph && graph.nodes.length > 0
                            ? <ArchView graph={graph} selectedId={selectedId} onSelect={setSelectedId} />
                            : <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", p: 3, textAlign: "center" }}>
                                  <Typography variant="body2" sx={{ color: "text.secondary", maxWidth: 460 }}>{graph?.error ?? "No deployed resources yet."}</Typography>
                              </Box>}
                    </Box>
                    {selected && <NodeDetail node={selected} onClose={() => setSelectedId( null )} />}
                  </Box>
                : <Box sx={{ display: "flex", flexGrow: 1, minHeight: 0 }}>
                <Box sx={{ position: "relative", flexGrow: 1, minWidth: 0, bgcolor: "#0a0d12" }}>
                    {graph?.error && ( !laid || laid.placed.length === 0 ) && (
                        <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", p: 3, textAlign: "center" }}>
                            <Typography variant="body2" sx={{ color: "text.secondary", maxWidth: 460 }}>{graph.error}</Typography>
                        </Box>
                    )}

                    {laid && laid.placed.length > 0 && (
                        <svg
                            ref={svgRef}
                            width="100%" height="100%"
                            style={{ cursor: drag.current ? "grabbing" : "grab", display: "block" }}
                            onWheel={onWheel} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
                        >
                            <defs>
                                <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                                    <path d="M0,0 L10,5 L0,10 z" fill="#484f58" />
                                </marker>
                            </defs>
                            <g transform={`translate(${view.tx},${view.ty}) scale(${view.scale})`}>
                                {laid.edges.map( ( edge, index ) => (
                                    <path
                                        key={index}
                                        d={smoothPath( edge.points )}
                                        fill="none" stroke="#30363d" strokeWidth={1.5} markerEnd="url(#arrow)"
                                    />
                                ) )}
                                {laid.placed.map( ( { node, x, y } ) =>
                                {
                                    const { color, Icon } = awsStyle( node.type, node.category );
                                    const selected : boolean = node.id === selectedId;
                                    const tile : number = 30;
                                    const tileInset : number = ( NODE_H - tile ) / 2;   // vertically center the icon tile in the node
                                    return (
                                        <g key={node.id} transform={`translate(${x - NODE_W / 2},${y - NODE_H / 2})`}
                                           style={{ cursor: "pointer" }}
                                           onClick={( event ) => { event.stopPropagation(); if ( !drag.current?.moved ) setSelectedId( node.id ); }}>
                                            <title>{`${node.type}\n${node.physicalId ?? node.logicalId}\n${node.stack}`}</title>
                                            <rect width={NODE_W} height={NODE_H} rx={7}
                                                  fill={selected ? color : "#161b22"} fillOpacity={selected ? 0.22 : 1}
                                                  stroke={color} strokeWidth={selected ? 2.5 : 1.5} />
                                            {/* AWS service icon tile (official-ish color + glyph) */}
                                            <rect x={tileInset} y={tileInset} width={tile} height={tile} rx={6} fill={color} />
                                            <foreignObject x={tileInset} y={tileInset} width={tile} height={tile}>
                                                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: tile, height: tile }}>
                                                    <Icon style={{ color: "#fff", fontSize: 19 }} />
                                                </div>
                                            </foreignObject>
                                            <text x={tileInset + tile + 8} y={20} fill="#e6edf3" fontSize={13} fontWeight={700}>{trunc( node.typeLabel, 18 )}</text>
                                            <text x={tileInset + tile + 8} y={37} fill="#8b949e" fontSize={10.5} fontFamily={MONO}>{trunc( nodeName( node ), 20 )}</text>
                                        </g>
                                    );
                                } )}
                            </g>
                        </svg>
                    )}

                    {/* empty-after-filter hint */}
                    {laid && laid.placed.length === 0 && graph && graph.nodes.length > 0 && (
                        <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
                            <Typography variant="caption" sx={{ color: "text.disabled" }}>no resources in the selected categories</Typography>
                        </Box>
                    )}
                </Box>

                {selected && <NodeDetail node={selected} onClose={() => setSelectedId( null )} />}
            </Box>}
        </Box>
    );
}

// ── containers (docker ps + docker stats) ───────────────────────────────────────────────────────
const KIND_COLOR : Record<ContainerInfo[ "kind" ], string> =
    { service: "#3fb950", "ecs-task": "#79c0ff", lambda: "#f0883e", localstack: "#b07cff", infra: "#8b949e" };

const KIND_LABEL : Record<ContainerInfo[ "kind" ], string> =
    { service: "Service", "ecs-task": "ECS", lambda: "Lambda", localstack: "LocalStack", infra: "Infra" };

/** Derive the application-service label for a container (best-effort, for the filter). */
function appOf( container : ContainerInfo ) : string
{
    const name : string = container.name;
    if ( name.startsWith( "rupapp-" ) ) return name.slice( 7 ).split( "-" )[ 0 ];   // rupapp-app-app-main-1 → "app"
    if ( container.kind === "ecs-task" ) return name.startsWith( "ls-ecs-" ) ? "ecs" : name.split( "-" )[ 0 ];
    if ( container.kind === "localstack" ) return "localstack";
    return name.replace( /-\d+$/, "" );   // strip a trailing compose index
}

const CPU_COLOR = "#58c4ff";   // CPU charts + donut
const MEM_COLOR = "#b07cff";   // memory charts + donut

// Target selector — LocalStack vs a named ~/.aws profile (+ region). A real account is read-only.
function TargetSelector()
{
    const info : TargetInfo = useTarget();
    const isAws : boolean = info.target.kind === TargetKind.AWS;
    const value : string = isAws ? `aws:${info.target.profile}` : "localstack";
    const region : string = info.target.region ?? info.regions[ 0 ] ?? "us-east-1";

    /** Apply a selection from the target dropdown: "localstack" or an "aws:<profile>" value. */
    const onTarget = ( selection : string ) : void =>
    {
        if ( selection === "localstack" ) void targetStore.setTarget( { kind: TargetKind.LOCALSTACK } );
        else void targetStore.setTarget( { kind: TargetKind.AWS, profile: selection.slice( 4 ), region } );
    };

    return (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            <Select size="small" value={value} onChange={( event ) => onTarget( event.target.value )} sx={{ minWidth: 150, fontFamily: MONO, fontSize: 12 }}>
                <MenuItem value="localstack">LocalStack</MenuItem>
                {info.profiles.length === 0 && <MenuItem disabled value="__none">(no ~/.aws profiles)</MenuItem>}
                {info.profiles.map( ( profile ) => <MenuItem key={profile} value={`aws:${profile}`} sx={{ fontFamily: MONO, fontSize: 12 }}>AWS · {profile}</MenuItem> )}
            </Select>
            {isAws && (
                <Select size="small" value={region} onChange={( event ) => void targetStore.setTarget( { kind: TargetKind.AWS, profile: info.target.profile, region: event.target.value } )} sx={{ minWidth: 130, fontFamily: MONO, fontSize: 12 }}>
                    {info.regions.map( ( regionName ) => <MenuItem key={regionName} value={regionName} sx={{ fontFamily: MONO, fontSize: 12 }}>{regionName}</MenuItem> )}
                </Select>
            )}
            {info.readOnly && <Chip size="small" color="warning" variant="outlined" label="read-only" />}
        </Box>
    );
}

/** The Containers view — live docker stats (or ECS CloudWatch on AWS) with type + service filters. */
function ContainersPanel()
{
    // history + polling live in the central singleton, so it keeps recording across tab switches
    const { containers, error, loaded, history, bins } = useMetrics();
    const isAws : boolean = useTarget().target.kind === TargetKind.AWS;
    const windowMin : HistogramWindowMin = useSettings().histogramWindowMin;

    // multi-select filters: by type (kind) and by application service (empty set = show all)
    const [ typeSel, setTypeSel ] = useState<Set<ContainerInfo[ "kind" ]>>( new Set() );
    const [ appSel, setAppSel ]   = useState<Set<string>>( new Set() );

    const kinds : Array<ContainerInfo[ "kind" ]> = useMemo<Array<ContainerInfo[ "kind" ]>>(
        () => [ ...new Set( containers.map( ( container ) => container.kind ) ) ].sort(),
        [ containers ] );
    const apps : Array<string> = useMemo<Array<string>>(
        () => [ ...new Set( containers.map( appOf ) ) ].sort(),
        [ containers ] );

    const visible : Array<ContainerInfo> = containers.filter( ( container ) =>
        ( typeSel.size === 0 || typeSel.has( container.kind ) ) &&
        ( appSel.size === 0 || appSel.has( appOf( container ) ) ) );

    /** Toggle `value` in/out of a filter set, then push the new set through `apply`. */
    const toggle = <T,>( set : Set<T>, value : T, apply : ( next : Set<T> ) => void ) : void =>
    {
        const next : Set<T> = new Set( set );
        next.has( value ) ? next.delete( value ) : next.add( value );
        apply( next );
    };

    return (
        <Box sx={{ flexGrow: 1, minHeight: 0, overflow: "auto", p: 1.5 }}>
            {error && <Typography variant="body2" sx={{ color: "warning.main", mb: 1 }}>{error}</Typography>}
            {loaded && containers.length === 0 && !error && (
                <Typography variant="body2" sx={{ color: "text.disabled" }}>{isAws ? "no ECS services found in this account/region" : "no running containers"}</Typography>
            )}

            {/* filters: by type (kind) + by application service */}
            {containers.length > 0 && (
                <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.75, mb: 1 }}>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>type</Typography>
                    {kinds.map( ( kind ) =>
                    {
                        const active : boolean = typeSel.has( kind );
                        return (
                            <Chip key={kind} size="small" label={KIND_LABEL[ kind ]} onClick={() => toggle( typeSel, kind, setTypeSel )}
                                  variant={active ? "filled" : "outlined"}
                                  sx={{ cursor: "pointer", borderColor: KIND_COLOR[ kind ], color: active ? "#0d1117" : KIND_COLOR[ kind ], bgcolor: active ? KIND_COLOR[ kind ] : "transparent", fontWeight: 600 }} />
                        );
                    } )}
                    <Box sx={{ width: "1px", height: 18, bgcolor: "divider", mx: 0.5 }} />
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>service</Typography>
                    {apps.map( ( app ) =>
                    {
                        const active : boolean = appSel.has( app );
                        return (
                            <Chip key={app} size="small" label={app} onClick={() => toggle( appSel, app, setAppSel )}
                                  variant={active ? "filled" : "outlined"} color={active ? "primary" : "default"}
                                  sx={{ cursor: "pointer", fontFamily: MONO }} />
                        );
                    } )}
                    {( typeSel.size > 0 || appSel.size > 0 ) && (
                        <Button size="small" sx={{ minWidth: 0 }} onClick={() => { setTypeSel( new Set() ); setAppSel( new Set() ); }}>clear</Button>
                    )}
                </Box>
            )}

            {loaded && containers.length > 0 && visible.length === 0 && (
                <Typography variant="caption" sx={{ color: "text.disabled" }}>no containers match the filter</Typography>
            )}

            {visible.map( ( container ) =>
            {
                const mem : { used : string; limit : string } = splitMem( container.memUsage );
                const cpuPct : number = parseFloat( container.cpuPercent ?? "0" ) || 0;
                const memPct : number = parseFloat( container.memPercent ?? "0" ) || 0;
                const hist : MetricHistory | undefined = history.get( container.id || container.name );
                return (
                    <Box key={container.id || container.name} sx={{ display: "grid", gridTemplateColumns: "1fr auto 1.8fr", gap: 2, alignItems: "center", px: 1, py: 1, borderTop: "1px solid", borderColor: "divider" }}>
                        {/* name + image stacked */}
                        <Box sx={{ minWidth: 0 }}>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                                <Tooltip title={KIND_LABEL[ container.kind ]}><Box sx={{ width: 8, height: 8, borderRadius: "2px", bgcolor: KIND_COLOR[ container.kind ], flexShrink: 0 }} /></Tooltip>
                                <Typography variant="caption" noWrap sx={{ fontFamily: MONO, fontWeight: 700 }}>{container.name}</Typography>
                            </Box>
                            <Typography variant="caption" noWrap sx={{ display: "block", pl: 1.6, fontFamily: MONO, color: "text.disabled" }}>{container.image}</Typography>
                            <Typography variant="caption" noWrap sx={{ display: "block", pl: 1.6, color: "text.secondary" }}>{container.status}</Typography>
                        </Box>

                        {/* CPU + memory donut gauges */}
                        <Box sx={{ display: "flex", gap: 1.5 }}>
                            <Donut label="CPU" value={container.cpuPercent ?? "—"} fill={cpuPct} color={CPU_COLOR} />
                            <Donut label="MEM" value={mem.used} percent={container.memPercent ?? "—"} max={mem.limit} fill={memPct} color={MEM_COLOR} />
                        </Box>

                        {/* CPU + memory history charts (window from settings) */}
                        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                            <MetricChart label={`CPU · ${windowMin}m`} data={hist?.cpu ?? []} bins={bins} color={CPU_COLOR} />
                            <MetricChart label={`MEM · ${windowMin}m`} data={hist?.mem ?? []} bins={bins} color={MEM_COLOR} />
                        </Box>
                    </Box>
                );
            } )}

            <Typography variant="caption" sx={{ display: "block", mt: 1.5, color: "text.disabled" }}>
                {isAws
                    ? "ECS service CPU/Memory from CloudWatch (AWS/ECS utilization), refreshed every 20s — read-only."
                    : "Live `docker stats`, refreshed every 4s. Includes Develop-tab compose containers and LocalStack ECS tasks."}
            </Typography>
        </Box>
    );
}

// An open-hole (donut) gauge for one metric: the used fraction is the colored arc, the rest a track.
// `max` sits above the donut; the label, value, and percent sit in the center hole.
const DONUT = 84;

function Donut(
    { label, value, percent, max, fill, color } :
    { label : string; value : string; percent? : string; max? : string; fill : number; color : string }
)
{
    const pct : number = Math.max( 0, Math.min( 100, fill ) );
    return (
        <Box sx={{ textAlign: "center", width: DONUT }}>
            {/* always rendered (nbsp when absent) so both donuts stay vertically aligned */}
            <Typography variant="caption" sx={{ display: "block", fontFamily: MONO, fontSize: 9, color: "text.disabled", lineHeight: 1.4 }}>{max || " "}</Typography>
            <Box sx={{ position: "relative", width: DONUT, height: DONUT }}>
                <PieChart
                    width={DONUT}
                    height={DONUT}
                    margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                    skipAnimation
                    tooltip={{ trigger: "none" }}
                    slotProps={{ legend: { hidden: true } }}
                    series={[ {
                        innerRadius : 27,
                        outerRadius : 40,
                        paddingAngle: 1,
                        cornerRadius: 2,
                        data : [
                            { id: 0, value: pct, color },
                            { id: 1, value: 100 - pct, color: "#21262d" }
                        ]
                    } ]}
                />
                <Box sx={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                    <Typography sx={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, color, lineHeight: 1 }}>{label}</Typography>
                    <Typography sx={{ fontFamily: MONO, fontSize: 10, lineHeight: 1.3, color: "text.primary" }}>{value}</Typography>
                    {percent && <Typography sx={{ fontFamily: MONO, fontSize: 9, color: "text.disabled", lineHeight: 1 }}>{percent}</Typography>}
                </Box>
            </Box>
        </Box>
    );
}

// A history chart (MUI X SparkLineChart, smoothed line). The x-axis is a FIXED number of bins (the
// whole window); samples fill from the left and the line progresses rightward as data arrives, rather
// than a short line stretched across the full width. CPU/memory use distinct colors.
function MetricChart( { label, data, bins, color } : { label : string; data : Array<number>; bins : number; color : string } )
{
    const last : number = data.length > 0 ? data[ data.length - 1 ] : 0;
    // pad to `bins` with nulls on the right → constant width, line grows left→right (then rolls)
    const padded : Array<number | null> = data.length >= bins
        ? data.slice( -bins )
        : [ ...data, ...new Array( bins - data.length ).fill( null ) ];

    return (
        <Box>
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <Typography variant="caption" sx={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color }}>{label}</Typography>
                <Typography variant="caption" sx={{ fontFamily: MONO, fontSize: 10, color: "text.disabled" }}>{last.toFixed( 1 )}%</Typography>
            </Box>
            <Box sx={{ height: 30 }}>
                {data.length > 1
                    ? <SparkLineChart plotType="line" curve="natural" data={padded as unknown as Array<number>} height={30} colors={[ color ]} showHighlight showTooltip />
                    : <Box sx={{ height: 30, borderRadius: 1, border: "1px dashed", borderColor: "divider", display: "grid", placeItems: "center" }}>
                          <Typography variant="caption" sx={{ fontSize: 9, color: "text.disabled" }}>collecting…</Typography>
                      </Box>}
            </Box>
        </Box>
    );
}

/** Format one docker memory figure ("7.75GiB") to one decimal + a space + decimal unit ("7.7 GB"). */
function fmtMem( part : string ) : string
{
    const match : RegExpMatchArray | null = part.trim().match( /^([\d.]+)\s*([KMGT]?)i?B$/i );
    if ( !match ) return part.trim();
    return `${parseFloat( match[ 1 ] ).toFixed( 1 )} ${match[ 2 ].toUpperCase()}B`;
}

/** Split docker's "24.68MiB / 7.75GiB" into used + limit, each formatted ("24.7 MB" / "7.7 GB"). */
function splitMem( memUsage : string | undefined ) : { used : string; limit : string }
{
    if ( !memUsage ) return { used: "—", limit: "—" };
    const [ used, limit ] = memUsage.split( "/" ).map( ( segment ) => segment.trim() );
    return { used: used ? fmtMem( used ) : "—", limit: limit ? fmtMem( limit ) : "—" };
}

// ── detail panel ─────────────────────────────────────────────────────────────────────────────────
/** Right-hand detail panel for a selected resource: identity fields, type-specific views, log tail. */
function NodeDetail( { node, onClose } : { node : CloudNode; onClose : () => void } )
{
    const [ events, setEvents ] = useState<Array<LogEvent> | null>( null );
    const [ logErr, setLogErr ] = useState<string | undefined>();
    const [ busy, setBusy ]     = useState<boolean>( false );

    useEffect( () => { setEvents( null ); setLogErr( undefined ); }, [ node.id ] );

    /** Fetch the latest CloudWatch log events for this node's log group. */
    const tail = async () : Promise<void> =>
    {
        if ( !node.logGroup ) return;
        setBusy( true );
        try { const { events: tailedEvents, error } = await api.cloudTail( node.logGroup ); setEvents( tailedEvents ); setLogErr( error ); }
        finally { setBusy( false ); }
    };

    return (
        <Box sx={{ width: 360, flexShrink: 0, borderLeft: "1px solid", borderColor: "divider", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
                <Chip size="small" label={CATEGORY_LABEL[ node.category ]} sx={{ bgcolor: CATEGORY_COLOR[ node.category ], color: "#0d1117", fontWeight: 700 }} />
                <Typography variant="subtitle2" sx={{ fontWeight: 700, flexGrow: 1 }} noWrap>{node.typeLabel}</Typography>
                <IconButton size="small" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
            </Box>

            <Box sx={{ p: 1.5, overflow: "auto", flexGrow: 1 }}>
                <Field label="Type" value={node.type} mono />
                <Field label="Logical ID" value={node.logicalId} mono />
                {node.physicalId && <Field label="Physical ID" value={node.physicalId} mono />}
                <Field label="Stack" value={node.stack} mono />
                {node.status && <Field label="Status" value={node.status} />}

                {node.type === "AWS::ECS::Service" && node.physicalId && <EcsServiceDetail arn={node.physicalId} />}
                {node.type === "AWS::S3::Bucket" && node.physicalId && <S3Browser bucket={node.physicalId} />}
                {( node.type === "AWS::ApiGatewayV2::Api" || node.type === "AWS::ApiGateway::RestApi" ) && node.physicalId && <ApiGatewayRoutes apiId={node.physicalId} />}

                {node.logGroup
                    ? (
                        <Box sx={{ mt: 1.5 }}>
                            <Button size="small" variant="outlined" startIcon={busy ? <CircularProgress size={13} /> : <ArticleIcon fontSize="small" />} onClick={() => void tail()}>
                                Tail CloudWatch logs
                            </Button>
                            <Typography variant="caption" sx={{ display: "block", mt: 0.5, color: "text.disabled", fontFamily: MONO }}>{node.logGroup}</Typography>
                            {logErr && <Typography variant="caption" sx={{ color: "warning.main" }}>{logErr}</Typography>}
                            {events && (
                                <Box sx={{ mt: 1, p: 1, bgcolor: "#0a0d12", borderRadius: 1.5, border: "1px solid", borderColor: "divider", maxHeight: 320, overflow: "auto" }}>
                                    {events.length === 0
                                        ? <Typography variant="caption" sx={{ color: "text.disabled" }}>no recent log events</Typography>
                                        : events.map( ( event, index ) => (
                                              <Box key={index} component="pre" sx={{ m: 0, fontFamily: MONO, fontSize: 11, color: "#c9d1d9", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                                  {event.message}
                                              </Box>
                                          ) )}
                                </Box>
                            )}
                        </Box>
                    )
                    : <Typography variant="caption" sx={{ display: "block", mt: 1.5, color: "text.disabled" }}>No CloudWatch log group associated with this resource.</Typography>}
            </Box>
        </Box>
    );
}

// ── ECS service live state ────────────────────────────────────────────────────────────────────
/** Live ECS service counts (running/desired/pending), polled every 5s while mounted. */
function EcsServiceDetail( { arn } : { arn : string } )
{
    const [ state, setState ] = useState<EcsServiceState | null>( null );

    useEffect( () =>
    {
        let active = true;
        const load = () : void => { void api.ecsService( arn ).then( ( next : EcsServiceState ) => { if ( active ) setState( next ); } ); };
        load();
        const intervalId : ReturnType<typeof setInterval> = setInterval( load, 5000 );
        return () => { active = false; clearInterval( intervalId ); };
    }, [ arn ] );

    if ( !state ) return null;
    if ( state.error ) return <Typography variant="caption" sx={{ display: "block", mt: 1, color: "warning.main" }}>{state.error}</Typography>;

    const healthy : boolean = ( state.runningCount ?? 0 ) >= ( state.desiredCount ?? 0 ) && ( state.desiredCount ?? 0 ) > 0;

    return (
        <Box sx={{ mt: 1.5, mb: 0.5 }}>
            <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                <Chip size="small" color={healthy ? "success" : "warning"} label={`running ${state.runningCount ?? 0}/${state.desiredCount ?? 0}`} />
                {( state.pendingCount ?? 0 ) > 0 && <Chip size="small" variant="outlined" label={`pending ${state.pendingCount}`} />}
                {state.status && <Typography variant="caption" sx={{ color: "text.secondary" }}>{state.status}</Typography>}
            </Box>
            <Typography variant="caption" sx={{ display: "block", mt: 0.5, color: "text.disabled" }}>
                Per-task CPU/memory is in the <b>Containers</b> view (docker stats).
            </Typography>
        </Box>
    );
}

// ── S3 bucket browser ─────────────────────────────────────────────────────────────────────────
/** Prefix-by-prefix S3 object browser with a clickable breadcrumb. */
function S3Browser( { bucket } : { bucket : string } )
{
    const [ listing, setListing ] = useState<S3Listing | null>( null );
    const [ busy, setBusy ]       = useState<boolean>( false );

    /** List the bucket at the given prefix into state. */
    const load = useCallback( async ( prefix : string ) : Promise<void> =>
    {
        setBusy( true );
        try { setListing( await api.s3List( bucket, prefix ) ); }
        finally { setBusy( false ); }
    }, [ bucket ] );

    useEffect( () => { void load( "" ); }, [ load ] );

    const prefix : string = listing?.prefix ?? "";
    const segments : Array<string> = prefix.split( "/" ).filter( Boolean );

    return (
        <Box sx={{ mt: 1.5 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, flexGrow: 1 }}>Objects</Typography>
                {busy && <CircularProgress size={13} />}
            </Box>

            {/* breadcrumb */}
            <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.25, mb: 0.5 }}>
                <Button size="small" sx={{ minWidth: 0, px: 0.5, fontFamily: MONO, fontSize: 11 }} onClick={() => void load( "" )}>{bucket}</Button>
                {segments.map( ( segment, index ) => (
                    <Box key={index} sx={{ display: "flex", alignItems: "center" }}>
                        <Typography variant="caption" sx={{ color: "text.disabled" }}>/</Typography>
                        <Button size="small" sx={{ minWidth: 0, px: 0.5, fontFamily: MONO, fontSize: 11 }} onClick={() => void load( segments.slice( 0, index + 1 ).join( "/" ) + "/" )}>{segment}</Button>
                    </Box>
                ) )}
            </Box>

            <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1.5, maxHeight: 280, overflow: "auto" }}>
                {listing?.error
                    ? <Typography variant="caption" sx={{ color: "warning.main", p: 1, display: "block" }}>{listing.error}</Typography>
                    : ( listing && listing.folders.length === 0 && listing.objects.length === 0 )
                        ? <Typography variant="caption" sx={{ color: "text.disabled", p: 1, display: "block" }}>empty</Typography>
                        : (
                            <>
                                {listing?.folders.map( ( folder ) => (
                                    <Box key={folder} onClick={() => void load( folder )}
                                         sx={{ display: "flex", alignItems: "center", gap: 0.75, px: 1, py: 0.5, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}>
                                        <FolderIcon sx={{ fontSize: 15, color: "primary.main" }} />
                                        <Typography variant="caption" sx={{ fontFamily: MONO }}>{basename( folder )}/</Typography>
                                    </Box>
                                ) )}
                                {listing?.objects.map( ( object ) => (
                                    <Box key={object.key} sx={{ display: "flex", alignItems: "center", gap: 0.75, px: 1, py: 0.5 }}>
                                        <InsertDriveFileIcon sx={{ fontSize: 15, color: "text.disabled" }} />
                                        <Typography variant="caption" sx={{ fontFamily: MONO, flexGrow: 1, wordBreak: "break-all" }}>{basename( object.key )}</Typography>
                                        <Typography variant="caption" sx={{ color: "text.disabled" }}>{humanSize( object.size )}</Typography>
                                    </Box>
                                ) )}
                            </>
                        )}
            </Box>
            {listing?.truncated && <Typography variant="caption" sx={{ color: "text.disabled" }}>showing first 1000 entries</Typography>}
        </Box>
    );
}

// ── API Gateway routes ────────────────────────────────────────────────────────────────────────
/** Lists an API Gateway's routes + endpoint for the selected API resource (fetched once on mount). */
function ApiGatewayRoutes( { apiId } : { apiId : string } )
{
    const [ info, setInfo ] = useState<ApiGwInfo | null>( null );
    const [ busy, setBusy ] = useState<boolean>( false );

    useEffect( () =>
    {
        let active = true;
        setBusy( true );
        void api.apigwRoutes( apiId ).then( ( result ) => { if ( active ) setInfo( result ); } ).finally( () => { if ( active ) setBusy( false ); } );
        return () => { active = false; };
    }, [ apiId ] );

    return (
        <Box sx={{ mt: 1.5 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, flexGrow: 1 }}>Routes{info ? ` (${info.routes.length})` : ""}</Typography>
                {busy && <CircularProgress size={13} />}
            </Box>
            {info?.name && <Field label="API" value={`${info.name}${info.protocol ? ` · ${info.protocol}` : ""}`} />}
            {info?.endpoint && <Field label="Endpoint" value={info.endpoint} mono />}
            {info?.error && <Typography variant="caption" sx={{ color: "warning.main" }}>{info.error}</Typography>}
            {info && info.routes.length > 0 && (
                <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1.5, maxHeight: 280, overflow: "auto" }}>
                    {info.routes.map( ( route ) => (
                        <Box key={route.routeKey} sx={{ px: 1, py: 0.5, borderBottom: "1px solid", borderColor: "divider" }}>
                            <Typography variant="caption" sx={{ fontFamily: MONO, fontWeight: 600, display: "block" }}>{route.routeKey}</Typography>
                            {route.target && <Typography variant="caption" sx={{ color: "text.disabled", fontFamily: MONO }}>{route.target}</Typography>}
                        </Box>
                    ) )}
                </Box>
            )}
            {info && info.routes.length === 0 && !info.error && <Typography variant="caption" sx={{ color: "text.disabled" }}>no routes registered</Typography>}
        </Box>
    );
}

/** Last path segment of an S3 key (trailing slash stripped) — the displayed file/folder name. */
function basename( key : string ) : string
{
    const parts : Array<string> = key.replace( /\/$/, "" ).split( "/" );
    return parts[ parts.length - 1 ] ?? key;
}

/** Format a byte count as a human-readable size (B / KB / MB / GB). */
function humanSize( bytes : number ) : string
{
    if ( bytes < 1024 ) return `${bytes} B`;
    if ( bytes < 1024 * 1024 ) return `${( bytes / 1024 ).toFixed( 1 )} KB`;
    if ( bytes < 1024 * 1024 * 1024 ) return `${( bytes / 1024 / 1024 ).toFixed( 1 )} MB`;
    return `${( bytes / 1024 / 1024 / 1024 ).toFixed( 1 )} GB`;
}

/** A labeled read-only key/value row in the detail panel (mono font for IDs/ARNs). */
function Field( { label, value, mono } : { label : string; value : string; mono? : boolean } )
{
    return (
        <Box sx={{ mb: 1 }}>
            <Typography variant="caption" sx={{ color: "text.disabled", display: "block" }}>{label}</Typography>
            <Typography variant="body2" sx={{ fontFamily: mono ? MONO : "inherit", wordBreak: "break-all" }}>{value}</Typography>
        </Box>
    );
}

/** Truncate `text` to at most `max` chars, appending an ellipsis when shortened. */
function trunc( text : string, max : number ) : string { return text.length > max ? text.slice( 0, max - 1 ) + "…" : text; }

/** Smooth an edge's routed points into a bezier SVG path (Catmull-Rom → cubic bezier). */
function smoothPath( points : { x : number; y : number }[] ) : string
{
    if ( points.length < 2 ) return "";

    // two points → a single horizontal-ish cubic curve (rankdir is LR)
    if ( points.length === 2 )
    {
        const [ start, end ] = points;
        const midX : number = ( start.x + end.x ) / 2;
        return `M${start.x},${start.y} C${midX},${start.y} ${midX},${end.y} ${end.x},${end.y}`;
    }

    let path : string = `M${points[ 0 ].x},${points[ 0 ].y}`;
    for ( let index : number = 0; index < points.length - 1; index++ )
    {
        // prev / current / next / next-next, clamped at the ends — the four points the curve interpolates
        const prev : { x : number; y : number } = points[ index - 1 ] ?? points[ index ];
        const curr : { x : number; y : number } = points[ index ];
        const next : { x : number; y : number } = points[ index + 1 ];
        const after : { x : number; y : number } = points[ index + 2 ] ?? next;
        // control points placed 1/6 along the neighbor tangents (Catmull-Rom → bezier conversion)
        const control1X : number = curr.x + ( next.x - prev.x ) / 6;
        const control1Y : number = curr.y + ( next.y - prev.y ) / 6;
        const control2X : number = next.x - ( after.x - curr.x ) / 6;
        const control2Y : number = next.y - ( after.y - curr.y ) / 6;
        path += ` C${control1X},${control1Y} ${control2X},${control2Y} ${next.x},${next.y}`;
    }
    return path;
}

/** Readable node subtitle: the physical name, unless it's an opaque ARN — then the logical id. */
function nodeName( node : CloudNode ) : string
{
    const physicalId : string | undefined = node.physicalId;
    if ( !physicalId || physicalId.startsWith( "arn:" ) ) return node.logicalId;
    return physicalId;
}

// ── VpcLink data-path diagnosis (API Gateway → VpcLink → ALB → ECS) ─────────────────────────────
const DIAG_COLOR : Record<DiagLevel, string> = { ok: "#3fb950", warn: "#d29922", error: "#f85149" };
const DIAG_ICON  : Record<DiagLevel, string> = { ok: "✓", warn: "!", error: "✕" };

/** The Diagnose view — read-only walk of the API Gateway → VpcLink → ALB → ECS request path. */
function DiagnosePanel()
{
    const targetInfo : TargetInfo = useTarget();
    const [ diag, setDiag ] = useState<VpcLinkDiagnosis | null>( null );
    const [ busy, setBusy ] = useState<boolean>( false );
    const [ copied, setCopied ] = useState<boolean>( false );
    const [ tests, setTests ] = useState<Array<RouteTest> | null>( null );
    const [ testing, setTesting ] = useState<boolean>( false );

    /** Run the read-only data-path diagnosis, clearing any prior routing-test results. */
    const run = useCallback( async () : Promise<void> =>
    {
        setBusy( true );
        setTests( null );
        try { setDiag( await api.vpcLinkDiagnose() ); }
        finally { setBusy( false ); }
    }, [] );

    // re-run when the target changes; clear stale results immediately
    useEffect( () => { setDiag( null ); setTests( null ); void run(); }, [ run, targetInfo.target.kind, targetInfo.target.profile, targetInfo.target.region ] );

    // invoke every route through its gateway URL — the actual end-to-end routing test
    const testRoutes : { apiId : string; routeKey : string; method : string; url : string }[] = useMemo( () =>
    {
        const routes : { apiId : string; routeKey : string; method : string; url : string }[] = [];
        for ( const apiEntry of diag?.apis ?? [] )
        {
            if ( !apiEntry.endpoint ) continue;
            for ( const routeKey of apiEntry.routes )
            {
                // "$default" has no method/path; otherwise routeKey is "METHOD /path". ANY → GET to probe.
                const [ rawMethod, rawPath = "/" ] = routeKey === "$default" ? [ "GET", "/" ] : routeKey.split( /\s+/ );
                const method : string = rawMethod === "ANY" ? "GET" : rawMethod;
                routes.push( { apiId: apiEntry.apiId, routeKey, method, url: apiEntry.endpoint + rawPath } );
            }
        }
        return routes;
    }, [ diag ] );

    /** Invoke each candidate route through its gateway URL and record the results. */
    const runTests = async () : Promise<void> =>
    {
        setTesting( true );
        try
        {
            const results : Array<RouteTest> = [];
            for ( const route of testRoutes )
            {
                const response = await api.apiSend( { method: route.method, url: route.url, headers: {} } );
                results.push( {
                    apiId: route.apiId, routeKey: route.routeKey, method: route.method, url: route.url,
                    ok: response.ok, status: response.status, timeMs: response.timeMs,
                    bodySnippet: response.body ? response.body.slice( 0, 200 ) : undefined,
                    error: response.error
                } );
            }
            setTests( results );
        }
        finally { setTesting( false ); }
    };

    /** Copy a pasteable markdown report of the diagnosis (+ any tests) to the clipboard. */
    const copyReport = () : void =>
    {
        if ( !diag ) return;
        void navigator.clipboard.writeText( diagReport( diag, tests ) ).then( () =>
        {
            setCopied( true );
            globalThis.setTimeout( () => setCopied( false ), 1800 );
        } );
    };

    return (
        <Box sx={{ flexGrow: 1, minHeight: 0, overflow: "auto", p: 1.5 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>API Gateway → VpcLink → ALB → ECS</Typography>
                <Box sx={{ flexGrow: 1 }} />
                <Button size="small" variant="outlined" startIcon={copied ? undefined : <ContentCopyIcon fontSize="small" />}
                        disabled={!diag} onClick={copyReport}>{copied ? "Copied!" : "Copy for support"}</Button>
                <Tooltip title={testRoutes.length === 0 ? "No routes with a resolvable gateway URL" : `Invoke ${testRoutes.length} route(s) through the gateway`}>
                    <span>
                        <Button size="small" variant="contained" color="success" disabled={testRoutes.length === 0 || testing}
                                startIcon={testing ? <CircularProgress size={13} /> : <TroubleshootIcon fontSize="small" />}
                                onClick={() => void runTests()}>Test routing</Button>
                    </span>
                </Tooltip>
                <Button size="small" variant="outlined" startIcon={busy ? <CircularProgress size={13} /> : <RefreshIcon fontSize="small" />}
                        onClick={() => void run()}
                        sx={{ color: "#56d364", borderColor: "#56d364", "&:hover": { borderColor: "#7ee787", bgcolor: "rgba(86,211,100,0.08)" } }}>Re-run</Button>
            </Box>

            <Typography variant="caption" sx={{ color: "text.disabled", display: "block", mb: 1.5 }}>
                Read-only walk of the request path. The key check is target registration: if ECS tasks are running but the ALB
                target group has no healthy targets, the gateway → ALB → ECS hop has no backend.
            </Typography>

            {diag?.error && (
                <Typography variant="body2" sx={{ color: DIAG_COLOR.error, mb: 1.5 }}>{diag.error}</Typography>
            )}

            {/* findings — the verdict */}
            {diag && (
                <Box sx={{ mb: 2 }}>
                    {diag.findings.map( ( finding : DiagFinding, index : number ) => (
                        <Box key={index} sx={{ display: "flex", gap: 1, mb: 0.75, p: 1, borderRadius: 1.5,
                                           border: "1px solid", borderColor: DIAG_COLOR[ finding.level ], bgcolor: `${DIAG_COLOR[ finding.level ]}14` }}>
                            <Typography sx={{ color: DIAG_COLOR[ finding.level ], fontWeight: 800, lineHeight: 1.4 }}>{DIAG_ICON[ finding.level ]}</Typography>
                            <Box>
                                <Typography variant="body2" sx={{ fontWeight: 700, color: DIAG_COLOR[ finding.level ] }}>{finding.title}</Typography>
                                {finding.detail && <Typography variant="caption" sx={{ color: "text.secondary" }}>{finding.detail}</Typography>}
                            </Box>
                        </Box>
                    ) )}
                </Box>
            )}

            {/* live routing test results */}
            {tests && (
                <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" sx={{ color: "text.disabled", fontWeight: 700, display: "block", mb: 0.75 }}>
                        Routing test — invoked through the gateway URL
                    </Typography>
                    {tests.length === 0 && <Empty />}
                    {tests.map( ( test : RouteTest, index : number ) =>
                    {
                        const good : boolean = test.ok && !test.error;
                        const color : string = good ? DIAG_COLOR.ok : DIAG_COLOR.error;
                        return (
                            <Box key={index} sx={{ mb: 0.75, p: 1, borderRadius: 1.5, border: "1px solid", borderColor: color, bgcolor: `${color}14` }}>
                                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                    <Chip size="small" label={good ? `${test.status} OK` : ( test.error ? "FAILED" : `${test.status}` )}
                                          sx={{ bgcolor: color, color: "#0d1117", fontWeight: 700 }} />
                                    <Typography variant="body2" sx={{ fontFamily: MONO }}>{test.method} {test.routeKey}</Typography>
                                    <Box sx={{ flexGrow: 1 }} />
                                    <Typography variant="caption" sx={{ color: "text.disabled" }}>{test.timeMs} ms</Typography>
                                </Box>
                                <Typography variant="caption" sx={{ display: "block", color: "text.disabled", fontFamily: MONO, wordBreak: "break-all" }}>{test.url}</Typography>
                                {test.error && <Typography variant="caption" sx={{ display: "block", color: DIAG_COLOR.error }}>{test.error}</Typography>}
                                {!test.error && test.bodySnippet && <Typography variant="caption" sx={{ display: "block", color: "text.secondary", fontFamily: MONO, wordBreak: "break-all" }}>{test.bodySnippet}</Typography>}
                            </Box>
                        );
                    } )}
                </Box>
            )}

            {/* raw resource state */}
            {diag && (
                <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
                    <DiagSection title={`ECS services (${diag.services.length})`}>
                        {diag.services.length === 0 && <Empty />}
                        {diag.services.map( ( service ) => (
                            <Box key={`${service.cluster}/${service.service}`} sx={{ mb: 0.75 }}>
                                <Typography variant="body2" sx={{ fontFamily: MONO }}>
                                    {service.service} <span style={{ color: service.running > 0 ? DIAG_COLOR.ok : DIAG_COLOR.error }}>{service.running}/{service.desired} running</span>
                                </Typography>
                                {service.tasks.map( ( task ) => (
                                    <Typography key={task.taskArn} variant="caption" sx={{ display: "block", color: "text.disabled", fontFamily: MONO, pl: 1 }}>
                                        {task.taskArn.slice( 0, 12 )} · {task.lastStatus} · {task.healthStatus}{task.ip ? ` · ${task.ip}` : ""}
                                    </Typography>
                                ) )}
                            </Box>
                        ) )}
                    </DiagSection>

                    <DiagSection title={`ALB target groups (${diag.targetGroups.length})`}>
                        {diag.targetGroups.length === 0 && <Empty />}
                        {diag.targetGroups.map( ( targetGroup ) => (
                            <Box key={targetGroup.name} sx={{ mb: 0.75 }}>
                                <Typography variant="body2" sx={{ fontFamily: MONO }}>
                                    {targetGroup.name} <span style={{ color: "#8b949e" }}>{targetGroup.protocol}:{targetGroup.port} {targetGroup.targetType}</span>
                                </Typography>
                                {targetGroup.targets.length === 0
                                    ? <Typography variant="caption" sx={{ display: "block", color: DIAG_COLOR.error, pl: 1 }}>no registered targets</Typography>
                                    : targetGroup.targets.map( ( target, index ) => (
                                        <Typography key={index} variant="caption" sx={{ display: "block", pl: 1, fontFamily: MONO,
                                                    color: /healthy/i.test( target.state ) ? DIAG_COLOR.ok : DIAG_COLOR.warn }}>
                                            {target.id}{target.port ? `:${target.port}` : ""} · {target.state}{target.reason ? ` (${target.reason})` : ""}
                                        </Typography>
                                    ) )}
                            </Box>
                        ) )}
                    </DiagSection>

                    <DiagSection title={`Load balancers (${diag.loadBalancers.length})`}>
                        {diag.loadBalancers.length === 0 && <Empty />}
                        {diag.loadBalancers.map( ( loadBalancer ) => (
                            <Typography key={loadBalancer.name} variant="caption" sx={{ display: "block", fontFamily: MONO, color: "text.secondary" }}>
                                {loadBalancer.name} · {loadBalancer.type} · {loadBalancer.scheme} · {loadBalancer.state}
                            </Typography>
                        ) )}
                    </DiagSection>

                    <DiagSection title={`VpcLinks (${diag.vpcLinks.length})`}>
                        {diag.vpcLinks.length === 0 && <Empty />}
                        {diag.vpcLinks.map( ( vpcLink ) => (
                            <Typography key={vpcLink.id} variant="caption" sx={{ display: "block", fontFamily: MONO,
                                        color: /AVAILABLE/i.test( vpcLink.status ?? "" ) ? DIAG_COLOR.ok : DIAG_COLOR.warn }}>
                                {vpcLink.name ?? vpcLink.id} · {vpcLink.status}
                            </Typography>
                        ) )}
                    </DiagSection>

                    <DiagSection title={`HTTP APIs (${diag.apis.length})`} wide>
                        {diag.apis.length === 0 && <Empty />}
                        {diag.apis.map( ( apiEntry ) => (
                            <Box key={apiEntry.apiId} sx={{ mb: 0.75 }}>
                                <Typography variant="body2" sx={{ fontFamily: MONO }}>{apiEntry.name ?? apiEntry.apiId} <span style={{ color: "#8b949e" }}>{apiEntry.protocol} · {apiEntry.apiId}</span></Typography>
                                <Typography variant="caption" sx={{ display: "block", color: "text.disabled", pl: 1 }}>routes: {apiEntry.routes.join( ", " ) || "—"}</Typography>
                                {apiEntry.integrations.map( ( integration ) => (
                                    <Typography key={integration.id} variant="caption" sx={{ display: "block", pl: 1, fontFamily: MONO,
                                                color: /VPC_LINK/i.test( integration.connectionType ?? "" ) ? DIAG_COLOR.ok : "text.disabled" }}>
                                        {integration.connectionType ?? "—"}{integration.connectionId ? ` (${integration.connectionId})` : ""} → {trunc( integration.uri ?? "—", 60 )}
                                    </Typography>
                                ) )}
                            </Box>
                        ) )}
                    </DiagSection>
                </Box>
            )}
        </Box>
    );
}

/** A titled bordered section in the diagnose grid; `wide` spans both columns. */
function DiagSection( { title, wide, children } : { title : string; wide? : boolean; children : ReactNode } )
{
    return (
        <Box sx={{ gridColumn: wide ? "1 / -1" : "auto", border: "1px solid", borderColor: "divider", borderRadius: 1.5, p: 1.25 }}>
            <Typography variant="caption" sx={{ color: "text.disabled", fontWeight: 700, display: "block", mb: 0.75 }}>{title}</Typography>
            {children}
        </Box>
    );
}

/** Placeholder shown when a diagnose section has no entries. */
function Empty() { return <Typography variant="caption" sx={{ color: "text.disabled" }}>none found</Typography>; }

/** Build a markdown report from a diagnosis — pasteable into a support ticket. */
function diagReport( diagnosis : VpcLinkDiagnosis, tests : Array<RouteTest> | null ) : string
{
    const lines : Array<string> = [];
    lines.push( `# API Gateway → VpcLink → ALB → ECS diagnosis (${diagnosis.targetKind})` );
    lines.push( "" );
    lines.push( "## Findings" );
    for ( const finding of diagnosis.findings ) lines.push( `- [${finding.level.toUpperCase()}] ${finding.title}${finding.detail ? ` — ${finding.detail}` : ""}` );
    lines.push( "" );
    if ( tests && tests.length > 0 )
    {
        lines.push( "## Routing test (invoked through the gateway URL)" );
        for ( const test of tests )
            lines.push( `- ${test.method} ${test.routeKey} → ${test.url}\n    - ${test.error ? `FAILED: ${test.error}` : `${test.status} (${test.timeMs} ms)`}` );
        lines.push( "" );
    }
    lines.push( "## ECS services" );
    if ( diagnosis.services.length === 0 ) lines.push( "- none" );
    for ( const service of diagnosis.services )
    {
        lines.push( `- ${service.service} (${service.cluster}): ${service.running}/${service.desired} running` );
        for ( const task of service.tasks ) lines.push( `    - ${task.taskArn} · ${task.lastStatus} · ${task.healthStatus}${task.ip ? ` · ${task.ip}` : ""}` );
    }
    lines.push( "" );
    lines.push( "## ALB target groups (registration + health)" );
    if ( diagnosis.targetGroups.length === 0 ) lines.push( "- none" );
    for ( const targetGroup of diagnosis.targetGroups )
    {
        lines.push( `- ${targetGroup.name} (${targetGroup.protocol}:${targetGroup.port} ${targetGroup.targetType}): ${targetGroup.targets.length} target(s)` );
        for ( const target of targetGroup.targets ) lines.push( `    - ${target.id}${target.port ? `:${target.port}` : ""} · ${target.state}${target.reason ? ` (${target.reason})` : ""}` );
    }
    lines.push( "" );
    lines.push( "## Load balancers" );
    for ( const loadBalancer of diagnosis.loadBalancers ) lines.push( `- ${loadBalancer.name} · ${loadBalancer.type} · ${loadBalancer.scheme} · ${loadBalancer.state} · ${loadBalancer.dnsName ?? ""}` );
    lines.push( "" );
    lines.push( "## VpcLinks" );
    for ( const vpcLink of diagnosis.vpcLinks ) lines.push( `- ${vpcLink.name ?? vpcLink.id} (${vpcLink.id}): ${vpcLink.status}` );
    lines.push( "" );
    lines.push( "## HTTP APIs + integrations" );
    for ( const apiEntry of diagnosis.apis )
    {
        lines.push( `- ${apiEntry.name ?? apiEntry.apiId} (${apiEntry.apiId}, ${apiEntry.protocol}) routes: ${apiEntry.routes.join( ", " ) || "—"}` );
        for ( const integration of apiEntry.integrations ) lines.push( `    - ${integration.connectionType ?? "—"}${integration.connectionId ? ` (${integration.connectionId})` : ""} → ${integration.uri ?? "—"}` );
    }
    if ( diagnosis.error ) { lines.push( "" ); lines.push( `> error: ${diagnosis.error}` ); }
    return lines.join( "\n" );
}
