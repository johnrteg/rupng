import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import ViewListIcon from "@mui/icons-material/ViewList";
import RefreshIcon from "@mui/icons-material/Refresh";
import CenterFocusStrongIcon from "@mui/icons-material/CenterFocusStrong";
import ArticleIcon from "@mui/icons-material/Article";
import CloseIcon from "@mui/icons-material/Close";
import FolderIcon from "@mui/icons-material/Folder";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";

import type { ApiGwInfo, CloudCategory, CloudEdge, CloudGraph, CloudHealth, CloudNode, ContainerInfo, EcsServiceState, LogEvent, S3Listing, TargetInfo } from "../../shared/types";
import { api } from "../api";
import { useMetrics, type MetricHistory } from "../metricsStore";
import { targetStore, useTarget } from "../targetStore";
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

const NODE_W = 184;
const NODE_H = 50;

interface ViewTransform { tx : number; ty : number; scale : number; }

interface Placed { node : CloudNode; x : number; y : number; }
interface Laid { placed : Placed[]; edges : { points : { x : number; y : number }[] }[]; width : number; height : number; }

function layout( graph : CloudGraph ) : Laid
{
    // `g`/`gg`/the edge param are left inferred: dagre's Graph is generic and annotating it as
    // Graph<unknown,…> fights dagre.layout's GraphLabel constraint. Inference yields the correct types.
    const g = new dagre.graphlib.Graph();
    g.setGraph( { rankdir: "LR", nodesep: 26, ranksep: 70, marginx: 24, marginy: 24 } );
    g.setDefaultEdgeLabel( () => ( {} ) );

    const ids : Set<string> = new Set( graph.nodes.map( ( n ) => n.id ) );
    for ( const n of graph.nodes ) g.setNode( n.id, { width: NODE_W, height: NODE_H } );
    for ( const e of graph.edges ) if ( ids.has( e.from ) && ids.has( e.to ) ) g.setEdge( e.from, e.to );

    dagre.layout( g );

    const placed : Placed[] = graph.nodes.map( ( node : CloudNode ) : Placed =>
    {
        const p : { x : number; y : number } | undefined = g.node( node.id ) as { x : number; y : number } | undefined;
        return { node, x: p?.x ?? 0, y: p?.y ?? 0 };
    } );

    const edges : Laid[ "edges" ] = g.edges().map( ( e ) =>
    {
        const pts : { x : number; y : number }[] = ( g.edge( e ) as { points? : { x : number; y : number }[] } ).points ?? [];
        return { points: pts };
    } );

    const gg = g.graph();
    return { placed, edges, width: gg.width ?? 1000, height: gg.height ?? 600 };
}

export function CloudView()
{
    const [ graph, setGraph ]     = useState<CloudGraph | null>( null );
    const [ health, setHealth ]   = useState<CloudHealth | null>( null );
    const [ loading, setLoading ] = useState<boolean>( false );
    const [ selectedId, setSelectedId ] = useState<string | null>( null );

    const [ mode, setMode ] = useState<"graph" | "containers">( "graph" );
    const [ view, setView ] = useState<ViewTransform>( { tx: 24, ty: 24, scale: 0.85 } );
    const drag = useRef<{ x : number; y : number; moved : boolean } | null>( null );
    const svgRef = useRef<SVGSVGElement | null>( null );

    const refresh = useCallback( async () : Promise<void> =>
    {
        setLoading( true );
        try { const [ g, h ] = await Promise.all( [ api.cloudGraph(), api.cloudHealth() ] ); setGraph( g ); setHealth( h ); }
        finally { setLoading( false ); }
    }, [] );

    // refresh the graph + health when the view opens AND whenever the target (LocalStack/AWS) changes
    const targetInfo : TargetInfo = useTarget();
    useEffect( () => { void refresh(); }, [ refresh, targetInfo.target.kind, targetInfo.target.profile, targetInfo.target.region ] );
    useEffect( () => { const id = setInterval( () => { void api.cloudHealth().then( setHealth ); }, 15000 ); return () => clearInterval( id ); }, [] );

    const [ cats, setCats ] = useState<Set<CloudCategory>>( new Set() );
    const toggleCat = ( c : CloudCategory ) : void =>
        setCats( ( prev ) => { const n = new Set( prev ); n.has( c ) ? n.delete( c ) : n.add( c ); return n; } );

    // per-category node counts (over the full graph), used for the toolbar filter chips
    const catCounts : Record<CloudCategory, number> = useMemo<Record<CloudCategory, number>>( () =>
    {
        const m : Record<CloudCategory, number> = {} as Record<CloudCategory, number>;
        for ( const n of graph?.nodes ?? [] ) m[ n.category ] = ( m[ n.category ] ?? 0 ) + 1;
        return m;
    }, [ graph ] );

    // graph filtered to the selected categories (empty selection = show all)
    const visible = useMemo<CloudGraph | null>( () =>
    {
        if ( !graph ) return null;
        if ( cats.size === 0 ) return graph;
        const nodes : CloudNode[] = graph.nodes.filter( ( n ) => cats.has( n.category ) );
        const ids : Set<string> = new Set( nodes.map( ( n ) => n.id ) );
        const edges : CloudEdge[] = graph.edges.filter( ( e ) => ids.has( e.from ) && ids.has( e.to ) );
        return { ...graph, nodes, edges };
    }, [ graph, cats ] );

    const laid : Laid | null = useMemo<Laid | null>( () => ( visible ? layout( visible ) : null ), [ visible ] );
    const selected : CloudNode | null = useMemo<CloudNode | null>( () => graph?.nodes.find( ( n ) => n.id === selectedId ) ?? null, [ graph, selectedId ] );

    // pan / zoom
    const onWheel = ( e : React.WheelEvent ) : void =>
    {
        const rect : DOMRect | undefined = svgRef.current?.getBoundingClientRect();
        if ( !rect ) return;
        const cx : number = e.clientX - rect.left, cy : number = e.clientY - rect.top;
        setView( ( v : ViewTransform ) : ViewTransform =>
        {
            const next : number = Math.min( 2.5, Math.max( 0.2, v.scale * ( e.deltaY < 0 ? 1.1 : 0.9 ) ) );
            const wx : number = ( cx - v.tx ) / v.scale, wy : number = ( cy - v.ty ) / v.scale;
            return { scale: next, tx: cx - wx * next, ty: cy - wy * next };
        } );
    };
    const onDown = ( e : React.MouseEvent ) : void => { drag.current = { x: e.clientX, y: e.clientY, moved: false }; };
    const onMove = ( e : React.MouseEvent ) : void =>
    {
        if ( !drag.current ) return;
        const dx : number = e.clientX - drag.current.x, dy : number = e.clientY - drag.current.y;
        if ( Math.abs( dx ) + Math.abs( dy ) > 3 ) drag.current.moved = true;
        drag.current.x = e.clientX; drag.current.y = e.clientY;
        setView( ( v ) => ( { ...v, tx: v.tx + dx, ty: v.ty + dy } ) );
    };
    const onUp = () : void => { drag.current = null; };
    const fit = () : void => setView( { tx: 24, ty: 24, scale: 0.85 } );

    const runningServices : [ string, string ][] = health ? globalThis.Object.entries( health.services ).filter( ( [ , s ] ) => s === "running" || s === "available" ) : [];

    return (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
            {/* health / status strip */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 0.75, borderBottom: "1px solid", borderColor: "divider", flexWrap: "wrap" }}>
                <TargetSelector />
                <Chip color={health?.reachable ? "success" : "error"} variant={health?.reachable ? "filled" : "outlined"}
                      label={health?.reachable ? `LocalStack reachable${health.edition ? ` · ${health.edition}` : ""}` : "LocalStack unreachable"} />
                {health?.reachable && (
                    <Tooltip title={runningServices.map( ( [ k, s ] ) => `${k}: ${s}` ).join( "\n" ) || "no services reported"}>
                        <Chip variant="outlined" label={`${runningServices.length} services up`} />
                    </Tooltip>
                )}
                {graph && <Chip variant="outlined" label={`${graph.stacks.length} stacks`} />}
                {graph && <Chip variant="outlined" label={`${graph.nodes.length} resources`} />}
                <Box sx={{ flexGrow: 1 }} />
                <ToggleButtonGroup size="small" exclusive value={mode} onChange={( _e, v ) => v && setMode( v )}>
                    <ToggleButton value="graph" sx={{ px: 1.25 }}><AccountTreeIcon fontSize="small" sx={{ mr: 0.5 }} />Architecture</ToggleButton>
                    <ToggleButton value="containers" sx={{ px: 1.25 }}><ViewListIcon fontSize="small" sx={{ mr: 0.5 }} />Containers</ToggleButton>
                </ToggleButtonGroup>
                {mode === "graph" && <Tooltip title="Reset view"><IconButton size="small" onClick={fit}><CenterFocusStrongIcon fontSize="small" /></IconButton></Tooltip>}
                {mode === "graph" && <Button size="small" variant="outlined" startIcon={loading ? <CircularProgress size={13} /> : <RefreshIcon fontSize="small" />} onClick={() => void refresh()}>Refresh</Button>}
            </Box>

            {/* category filter (the interactive legend) */}
            {mode === "graph" && graph && graph.nodes.length > 0 && (
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, px: 1.5, py: 0.6, borderBottom: "1px solid", borderColor: "divider", flexWrap: "wrap", bgcolor: "background.paper" }}>
                    <Typography variant="caption" sx={{ color: "text.disabled", mr: 0.5 }}>{cats.size === 0 ? "showing all" : "filter:"}</Typography>
                    {( globalThis.Object.keys( CATEGORY_LABEL ) as CloudCategory[] )
                        .filter( ( c ) => ( catCounts[ c ] ?? 0 ) > 0 )
                        .map( ( c ) =>
                        {
                            const on : boolean = cats.has( c );
                            return (
                                <Chip
                                    key={c}
                                    onClick={() => toggleCat( c )}
                                    variant={on ? "filled" : "outlined"}
                                    label={`${CATEGORY_LABEL[ c ]} ${catCounts[ c ]}`}
                                    sx={{
                                        cursor      : "pointer",
                                        borderColor : CATEGORY_COLOR[ c ],
                                        color       : on ? "#0d1117" : CATEGORY_COLOR[ c ],
                                        bgcolor     : on ? CATEGORY_COLOR[ c ] : "transparent",
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
                                {laid.edges.map( ( e, i ) => (
                                    <path
                                        key={i}
                                        d={smoothPath( e.points )}
                                        fill="none" stroke="#30363d" strokeWidth={1.5} markerEnd="url(#arrow)"
                                    />
                                ) )}
                                {laid.placed.map( ( { node, x, y } ) =>
                                {
                                    const color : string = CATEGORY_COLOR[ node.category ];
                                    const sel : boolean = node.id === selectedId;
                                    return (
                                        <g key={node.id} transform={`translate(${x - NODE_W / 2},${y - NODE_H / 2})`}
                                           style={{ cursor: "pointer" }}
                                           onClick={( ev ) => { ev.stopPropagation(); if ( !drag.current?.moved ) setSelectedId( node.id ); }}>
                                            <title>{`${node.type}\n${node.physicalId ?? node.logicalId}\n${node.stack}`}</title>
                                            <rect width={NODE_W} height={NODE_H} rx={7}
                                                  fill={sel ? color : "#161b22"} fillOpacity={sel ? 0.22 : 1}
                                                  stroke={color} strokeWidth={sel ? 2.5 : 1.5} />
                                            <rect width={4} height={NODE_H} rx={2} fill={color} />
                                            <text x={14} y={20} fill="#e6edf3" fontSize={13} fontWeight={700}>{trunc( node.typeLabel, 22 )}</text>
                                            <text x={14} y={37} fill="#8b949e" fontSize={10.5} fontFamily={MONO}>{trunc( nodeName( node ), 24 )}</text>
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
function appOf( c : ContainerInfo ) : string
{
    const n : string = c.name;
    if ( n.startsWith( "rupapp-" ) ) return n.slice( 7 ).split( "-" )[ 0 ];   // rupapp-app-app-main-1 → "app"
    if ( c.kind === "ecs-task" ) return n.startsWith( "ls-ecs-" ) ? "ecs" : n.split( "-" )[ 0 ];
    if ( c.kind === "localstack" ) return "localstack";
    return n.replace( /-\d+$/, "" );   // strip a trailing compose index
}

const CPU_COLOR = "#58c4ff";   // CPU charts + donut
const MEM_COLOR = "#b07cff";   // memory charts + donut

// Target selector — LocalStack vs a named ~/.aws profile (+ region). A real account is read-only.
function TargetSelector()
{
    const info : TargetInfo = useTarget();
    const isAws : boolean = info.target.kind === "aws";
    const value : string = isAws ? `aws:${info.target.profile}` : "localstack";
    const region : string = info.target.region ?? info.regions[ 0 ] ?? "us-east-1";

    const onTarget = ( v : string ) : void =>
    {
        if ( v === "localstack" ) void targetStore.setTarget( { kind: "localstack" } );
        else void targetStore.setTarget( { kind: "aws", profile: v.slice( 4 ), region } );
    };

    return (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            <Select size="small" value={value} onChange={( e ) => onTarget( e.target.value )} sx={{ minWidth: 150, fontFamily: MONO, fontSize: 12 }}>
                <MenuItem value="localstack">LocalStack</MenuItem>
                {info.profiles.length === 0 && <MenuItem disabled value="__none">(no ~/.aws profiles)</MenuItem>}
                {info.profiles.map( ( p ) => <MenuItem key={p} value={`aws:${p}`} sx={{ fontFamily: MONO, fontSize: 12 }}>AWS · {p}</MenuItem> )}
            </Select>
            {isAws && (
                <Select size="small" value={region} onChange={( e ) => void targetStore.setTarget( { kind: "aws", profile: info.target.profile, region: e.target.value } )} sx={{ minWidth: 130, fontFamily: MONO, fontSize: 12 }}>
                    {info.regions.map( ( r ) => <MenuItem key={r} value={r} sx={{ fontFamily: MONO, fontSize: 12 }}>{r}</MenuItem> )}
                </Select>
            )}
            {info.readOnly && <Chip size="small" color="warning" variant="outlined" label="read-only" />}
        </Box>
    );
}

function ContainersPanel()
{
    // history + polling live in the central singleton, so it keeps recording across tab switches
    const { containers, error, loaded, history, bins } = useMetrics();
    const isAws : boolean = useTarget().target.kind === "aws";
    const windowMin : HistogramWindowMin = useSettings().histogramWindowMin;

    // multi-select filters: by type (kind) and by application service (empty set = show all)
    const [ typeSel, setTypeSel ] = useState<Set<ContainerInfo[ "kind" ]>>( new Set() );
    const [ appSel, setAppSel ]   = useState<Set<string>>( new Set() );

    const kinds : ContainerInfo[ "kind" ][] = useMemo<ContainerInfo[ "kind" ][]>(
        () => [ ...new Set( containers.map( ( c ) => c.kind ) ) ].sort(),
        [ containers ] );
    const apps : string[] = useMemo<string[]>(
        () => [ ...new Set( containers.map( appOf ) ) ].sort(),
        [ containers ] );

    const visible : ContainerInfo[] = containers.filter( ( c ) =>
        ( typeSel.size === 0 || typeSel.has( c.kind ) ) &&
        ( appSel.size === 0 || appSel.has( appOf( c ) ) ) );

    const toggle = <T,>( set : Set<T>, v : T, apply : ( s : Set<T> ) => void ) : void =>
    {
        const n : Set<T> = new Set( set );
        n.has( v ) ? n.delete( v ) : n.add( v );
        apply( n );
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
                    {kinds.map( ( k ) =>
                    {
                        const on : boolean = typeSel.has( k );
                        return (
                            <Chip key={k} size="small" label={KIND_LABEL[ k ]} onClick={() => toggle( typeSel, k, setTypeSel )}
                                  variant={on ? "filled" : "outlined"}
                                  sx={{ cursor: "pointer", borderColor: KIND_COLOR[ k ], color: on ? "#0d1117" : KIND_COLOR[ k ], bgcolor: on ? KIND_COLOR[ k ] : "transparent", fontWeight: 600 }} />
                        );
                    } )}
                    <Box sx={{ width: "1px", height: 18, bgcolor: "divider", mx: 0.5 }} />
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>service</Typography>
                    {apps.map( ( a ) =>
                    {
                        const on : boolean = appSel.has( a );
                        return (
                            <Chip key={a} size="small" label={a} onClick={() => toggle( appSel, a, setAppSel )}
                                  variant={on ? "filled" : "outlined"} color={on ? "primary" : "default"}
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

            {visible.map( ( c ) =>
            {
                const mem : { used : string; limit : string } = splitMem( c.memUsage );
                const cpu : number = parseFloat( c.cpuPercent ?? "0" ) || 0;
                const memP : number = parseFloat( c.memPercent ?? "0" ) || 0;
                const hist : MetricHistory | undefined = history.get( c.id || c.name );
                return (
                    <Box key={c.id || c.name} sx={{ display: "grid", gridTemplateColumns: "1fr auto 1.8fr", gap: 2, alignItems: "center", px: 1, py: 1, borderTop: "1px solid", borderColor: "divider" }}>
                        {/* name + image stacked */}
                        <Box sx={{ minWidth: 0 }}>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                                <Tooltip title={KIND_LABEL[ c.kind ]}><Box sx={{ width: 8, height: 8, borderRadius: "2px", bgcolor: KIND_COLOR[ c.kind ], flexShrink: 0 }} /></Tooltip>
                                <Typography variant="caption" noWrap sx={{ fontFamily: MONO, fontWeight: 700 }}>{c.name}</Typography>
                            </Box>
                            <Typography variant="caption" noWrap sx={{ display: "block", pl: 1.6, fontFamily: MONO, color: "text.disabled" }}>{c.image}</Typography>
                            <Typography variant="caption" noWrap sx={{ display: "block", pl: 1.6, color: "text.secondary" }}>{c.status}</Typography>
                        </Box>

                        {/* CPU + memory donut gauges */}
                        <Box sx={{ display: "flex", gap: 1.5 }}>
                            <Donut label="CPU" value={c.cpuPercent ?? "—"} fill={cpu} color={CPU_COLOR} />
                            <Donut label="MEM" value={mem.used} percent={c.memPercent ?? "—"} max={mem.limit} fill={memP} color={MEM_COLOR} />
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
function MetricChart( { label, data, bins, color } : { label : string; data : number[]; bins : number; color : string } )
{
    const last : number = data.length > 0 ? data[ data.length - 1 ] : 0;
    // pad to `bins` with nulls on the right → constant width, line grows left→right (then rolls)
    const padded : ( number | null )[] = data.length >= bins
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
                    ? <SparkLineChart plotType="line" curve="natural" data={padded as unknown as number[]} height={30} colors={[ color ]} showHighlight showTooltip />
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
    const m : RegExpMatchArray | null = part.trim().match( /^([\d.]+)\s*([KMGT]?)i?B$/i );
    if ( !m ) return part.trim();
    return `${parseFloat( m[ 1 ] ).toFixed( 1 )} ${m[ 2 ].toUpperCase()}B`;
}

/** Split docker's "24.68MiB / 7.75GiB" into used + limit, each formatted ("24.7 MB" / "7.7 GB"). */
function splitMem( memUsage : string | undefined ) : { used : string; limit : string }
{
    if ( !memUsage ) return { used: "—", limit: "—" };
    const [ used, limit ] = memUsage.split( "/" ).map( ( s ) => s.trim() );
    return { used: used ? fmtMem( used ) : "—", limit: limit ? fmtMem( limit ) : "—" };
}

// ── detail panel ─────────────────────────────────────────────────────────────────────────────────
function NodeDetail( { node, onClose } : { node : CloudNode; onClose : () => void } )
{
    const [ events, setEvents ] = useState<LogEvent[] | null>( null );
    const [ logErr, setLogErr ] = useState<string | undefined>();
    const [ busy, setBusy ]     = useState<boolean>( false );

    useEffect( () => { setEvents( null ); setLogErr( undefined ); }, [ node.id ] );

    const tail = async () : Promise<void> =>
    {
        if ( !node.logGroup ) return;
        setBusy( true );
        try { const { events: ev, error } = await api.cloudTail( node.logGroup ); setEvents( ev ); setLogErr( error ); }
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
                                        : events.map( ( e, i ) => (
                                              <Box key={i} component="pre" sx={{ m: 0, fontFamily: MONO, fontSize: 11, color: "#c9d1d9", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                                  {e.message}
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
function EcsServiceDetail( { arn } : { arn : string } )
{
    const [ st, setSt ] = useState<EcsServiceState | null>( null );

    useEffect( () =>
    {
        let active = true;
        const load = () : void => { void api.ecsService( arn ).then( ( s : EcsServiceState ) => { if ( active ) setSt( s ); } ); };
        load();
        const id : ReturnType<typeof setInterval> = setInterval( load, 5000 );
        return () => { active = false; clearInterval( id ); };
    }, [ arn ] );

    if ( !st ) return null;
    if ( st.error ) return <Typography variant="caption" sx={{ display: "block", mt: 1, color: "warning.main" }}>{st.error}</Typography>;

    const healthy : boolean = ( st.runningCount ?? 0 ) >= ( st.desiredCount ?? 0 ) && ( st.desiredCount ?? 0 ) > 0;

    return (
        <Box sx={{ mt: 1.5, mb: 0.5 }}>
            <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                <Chip size="small" color={healthy ? "success" : "warning"} label={`running ${st.runningCount ?? 0}/${st.desiredCount ?? 0}`} />
                {( st.pendingCount ?? 0 ) > 0 && <Chip size="small" variant="outlined" label={`pending ${st.pendingCount}`} />}
                {st.status && <Typography variant="caption" sx={{ color: "text.secondary" }}>{st.status}</Typography>}
            </Box>
            <Typography variant="caption" sx={{ display: "block", mt: 0.5, color: "text.disabled" }}>
                Per-task CPU/memory is in the <b>Containers</b> view (docker stats).
            </Typography>
        </Box>
    );
}

// ── S3 bucket browser ─────────────────────────────────────────────────────────────────────────
function S3Browser( { bucket } : { bucket : string } )
{
    const [ listing, setListing ] = useState<S3Listing | null>( null );
    const [ busy, setBusy ]       = useState<boolean>( false );

    const load = useCallback( async ( prefix : string ) : Promise<void> =>
    {
        setBusy( true );
        try { setListing( await api.s3List( bucket, prefix ) ); }
        finally { setBusy( false ); }
    }, [ bucket ] );

    useEffect( () => { void load( "" ); }, [ load ] );

    const prefix : string = listing?.prefix ?? "";
    const segs : string[] = prefix.split( "/" ).filter( Boolean );

    return (
        <Box sx={{ mt: 1.5 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, flexGrow: 1 }}>Objects</Typography>
                {busy && <CircularProgress size={13} />}
            </Box>

            {/* breadcrumb */}
            <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.25, mb: 0.5 }}>
                <Button size="small" sx={{ minWidth: 0, px: 0.5, fontFamily: MONO, fontSize: 11 }} onClick={() => void load( "" )}>{bucket}</Button>
                {segs.map( ( s, i ) => (
                    <Box key={i} sx={{ display: "flex", alignItems: "center" }}>
                        <Typography variant="caption" sx={{ color: "text.disabled" }}>/</Typography>
                        <Button size="small" sx={{ minWidth: 0, px: 0.5, fontFamily: MONO, fontSize: 11 }} onClick={() => void load( segs.slice( 0, i + 1 ).join( "/" ) + "/" )}>{s}</Button>
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
                                {listing?.folders.map( ( f ) => (
                                    <Box key={f} onClick={() => void load( f )}
                                         sx={{ display: "flex", alignItems: "center", gap: 0.75, px: 1, py: 0.5, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}>
                                        <FolderIcon sx={{ fontSize: 15, color: "primary.main" }} />
                                        <Typography variant="caption" sx={{ fontFamily: MONO }}>{basename( f )}/</Typography>
                                    </Box>
                                ) )}
                                {listing?.objects.map( ( o ) => (
                                    <Box key={o.key} sx={{ display: "flex", alignItems: "center", gap: 0.75, px: 1, py: 0.5 }}>
                                        <InsertDriveFileIcon sx={{ fontSize: 15, color: "text.disabled" }} />
                                        <Typography variant="caption" sx={{ fontFamily: MONO, flexGrow: 1, wordBreak: "break-all" }}>{basename( o.key )}</Typography>
                                        <Typography variant="caption" sx={{ color: "text.disabled" }}>{humanSize( o.size )}</Typography>
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
function ApiGatewayRoutes( { apiId } : { apiId : string } )
{
    const [ info, setInfo ] = useState<ApiGwInfo | null>( null );
    const [ busy, setBusy ] = useState<boolean>( false );

    useEffect( () =>
    {
        let active = true;
        setBusy( true );
        void api.apigwRoutes( apiId ).then( ( i ) => { if ( active ) setInfo( i ); } ).finally( () => { if ( active ) setBusy( false ); } );
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
                    {info.routes.map( ( r ) => (
                        <Box key={r.routeKey} sx={{ px: 1, py: 0.5, borderBottom: "1px solid", borderColor: "divider" }}>
                            <Typography variant="caption" sx={{ fontFamily: MONO, fontWeight: 600, display: "block" }}>{r.routeKey}</Typography>
                            {r.target && <Typography variant="caption" sx={{ color: "text.disabled", fontFamily: MONO }}>{r.target}</Typography>}
                        </Box>
                    ) )}
                </Box>
            )}
            {info && info.routes.length === 0 && !info.error && <Typography variant="caption" sx={{ color: "text.disabled" }}>no routes registered</Typography>}
        </Box>
    );
}

function basename( key : string ) : string
{
    const parts : string[] = key.replace( /\/$/, "" ).split( "/" );
    return parts[ parts.length - 1 ] ?? key;
}

function humanSize( n : number ) : string
{
    if ( n < 1024 ) return `${n} B`;
    if ( n < 1024 * 1024 ) return `${( n / 1024 ).toFixed( 1 )} KB`;
    if ( n < 1024 * 1024 * 1024 ) return `${( n / 1024 / 1024 ).toFixed( 1 )} MB`;
    return `${( n / 1024 / 1024 / 1024 ).toFixed( 1 )} GB`;
}

function Field( { label, value, mono } : { label : string; value : string; mono? : boolean } )
{
    return (
        <Box sx={{ mb: 1 }}>
            <Typography variant="caption" sx={{ color: "text.disabled", display: "block" }}>{label}</Typography>
            <Typography variant="body2" sx={{ fontFamily: mono ? MONO : "inherit", wordBreak: "break-all" }}>{value}</Typography>
        </Box>
    );
}

function trunc( s : string, n : number ) : string { return s.length > n ? s.slice( 0, n - 1 ) + "…" : s; }

/** Smooth an edge's routed points into a bezier SVG path (Catmull-Rom → cubic bezier). */
function smoothPath( points : { x : number; y : number }[] ) : string
{
    if ( points.length < 2 ) return "";

    // two points → a single horizontal-ish cubic curve (rankdir is LR)
    if ( points.length === 2 )
    {
        const [ a, b ] = points;
        const mx : number = ( a.x + b.x ) / 2;
        return `M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`;
    }

    const p : { x : number; y : number }[] = points;
    let d : string = `M${p[ 0 ].x},${p[ 0 ].y}`;
    for ( let i : number = 0; i < p.length - 1; i++ )
    {
        const p0 : { x : number; y : number } = p[ i - 1 ] ?? p[ i ];
        const p1 : { x : number; y : number } = p[ i ];
        const p2 : { x : number; y : number } = p[ i + 1 ];
        const p3 : { x : number; y : number } = p[ i + 2 ] ?? p2;
        const cp1x : number = p1.x + ( p2.x - p0.x ) / 6;
        const cp1y : number = p1.y + ( p2.y - p0.y ) / 6;
        const cp2x : number = p2.x - ( p3.x - p1.x ) / 6;
        const cp2y : number = p2.y - ( p3.y - p1.y ) / 6;
        d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
    }
    return d;
}

/** Readable node subtitle: the physical name, unless it's an opaque ARN — then the logical id. */
function nodeName( node : CloudNode ) : string
{
    const p : string | undefined = node.physicalId;
    if ( !p || p.startsWith( "arn:" ) ) return node.logicalId;
    return p;
}
