import { useMemo, useRef, useState } from "react";
import dagre from "@dagrejs/dagre";
import CloudIcon from "@mui/icons-material/Cloud";

import type { CloudGraph, CloudNode } from "../../shared/types";
import { awsStyle } from "../awsIcons";
import { MONO } from "../theme";

//
// The "Architecture" view — a curated, top-down diagram (vs. the raw reference graph). Resources are
// GROUPED BY SERVICE: every node carries its CloudFormation stack (app-local, web-local, platform-…),
// and each stack is one service's footprint, so it becomes a labeled box containing that service's
// ECS cluster / service / Lambdas / tables / buckets / etc. The shared `platform` stack (VPC, MSK,
// OpenSearch) is its own box. Internet sits outside as the entry point. The request path
// (Internet → API Gateway → VpcLink → ALB → ECS service) is drawn as solid edges; a service's data
// dependencies as dashed edges. dagre COMPOUND lays out the nested boxes.
//

const NW = 188;
const NH = 46;
const TILE = 28;
const INTERNET = "__internet__";
const BOX_COLORS = [ "#5b9dff", "#3fb950", "#d29922", "#b07cff", "#f0883e", "#79c0ff", "#e7157b" ];

interface ViewT { tx : number; ty : number; scale : number; }
interface ABox { id : string; label : string; color : string; x : number; y : number; w : number; h : number; }
interface ALeaf { node : CloudNode; x : number; y : number; }
interface AEdge { d : string; dashed : boolean; }
interface Arch { boxes : ABox[]; leaves : ALeaf[]; internet : { x : number; y : number } | null; edges : AEdge[]; }

// resources too low-level / noisy to chart
const DENY : RegExp[] = [
    /^AWS::IAM::/, /^AWS::Logs::/, /^AWS::SSM::/, /^Custom::/, /^AWS::CDK::/, /Permission$/,
    /^AWS::ApiGatewayV2::(Route|Integration|Stage|Deployment)/,
    /^AWS::EC2::(SecurityGroup|Route$|RouteTable|SubnetRouteTableAssociation|VPCGatewayAttachment|SecurityGroupIngress|SecurityGroupEgress|VPCEndpoint)/,
];
const archKeep = ( t : string ) : boolean => !DENY.some( ( re ) => re.test( t ) );
// a service's data/integration dependencies — drawn with dashed edges from the service
const isUses   = ( t : string ) : boolean => /^AWS::(DynamoDB|S3|KMS|SecretsManager|SQS|SNS|Events|MSK|Scheduler|Cognito|OpenSearchService|SES|MediaConvert)::/.test( t );

/** "app-local" / "platform-staging" → "app" / "platform" (drop the env suffix for the box label). */
function serviceOf( stack : string ) : string
{
    return stack.replace( /-(local|dev|development|staging|production|prod)$/i, "" );
}

function smooth( p : { x : number; y : number }[] ) : string
{
    if ( p.length < 2 ) return "";
    if ( p.length === 2 ) { const my : number = ( p[ 0 ].y + p[ 1 ].y ) / 2; return `M${p[ 0 ].x},${p[ 0 ].y} C${p[ 0 ].x},${my} ${p[ 1 ].x},${my} ${p[ 1 ].x},${p[ 1 ].y}`; }
    let d : string = `M${p[ 0 ].x},${p[ 0 ].y}`;
    for ( let i : number = 0; i < p.length - 1; i++ )
    {
        const p0 = p[ i - 1 ] ?? p[ i ], p1 = p[ i ], p2 = p[ i + 1 ], p3 = p[ i + 2 ] ?? p2;
        d += ` C${p1.x + ( p2.x - p0.x ) / 6},${p1.y + ( p2.y - p0.y ) / 6} ${p2.x - ( p3.x - p1.x ) / 6},${p2.y - ( p3.y - p1.y ) / 6} ${p2.x},${p2.y}`;
    }
    return d;
}

function shortName( n : CloudNode ) : string
{
    const p : string | undefined = n.physicalId;
    return !p || p.startsWith( "arn:" ) ? n.logicalId : p;
}
function trunc( s : string, n : number ) : string { return s.length > n ? s.slice( 0, n - 1 ) + "…" : s; }

function archLayout( graph : CloudGraph ) : Arch
{
    const keep : CloudNode[] = graph.nodes.filter( ( n ) => archKeep( n.type ) );
    const byId : Map<string, CloudNode> = new Map( keep.map( ( n ) => [ n.id, n ] ) );

    // one box per stack (= per service), platform last
    const stacks : string[] = [ ...new Set( keep.map( ( n ) => n.stack ) ) ]
        .sort( ( a, b ) => ( a.startsWith( "platform" ) ? 1 : 0 ) - ( b.startsWith( "platform" ) ? 1 : 0 ) || a.localeCompare( b ) );
    const boxColor : Map<string, string> = new Map( stacks.map( ( s, i ) => [ s, BOX_COLORS[ i % BOX_COLORS.length ] ] ) );

    const g = new dagre.graphlib.Graph( { compound: true } );
    g.setGraph( { rankdir: "TB", align: "UL", nodesep: 24, ranksep: 52, marginx: 24, marginy: 24 } );
    g.setDefaultEdgeLabel( () => ( {} ) );

    for ( const s of stacks ) g.setNode( `stk:${s}`, { label: serviceOf( s ) } );
    for ( const n of keep ) { g.setNode( n.id, { width: NW, height: NH } ); g.setParent( n.id, `stk:${n.stack}` ); }
    g.setNode( INTERNET, { width: 130, height: NH } );

    // request-path spine
    const find = ( t : string ) : CloudNode | undefined => keep.find( ( n ) => n.type === t );
    const spine : string[] = [
        INTERNET,
        find( "AWS::ApiGatewayV2::Api" )?.id,
        find( "AWS::ApiGatewayV2::VpcLink" )?.id,
        find( "AWS::ElasticLoadBalancingV2::LoadBalancer" )?.id,
        find( "AWS::ECS::Service" )?.id,
    ].filter( Boolean ) as string[];
    for ( let i : number = 0; i < spine.length - 1; i++ ) g.setEdge( spine[ i ], spine[ i + 1 ] );

    // dashed data edges from each ECS service to the resources it uses (same stack)
    const dashed : Set<string> = new Set();
    for ( const svc of keep.filter( ( n ) => n.type === "AWS::ECS::Service" ) )
        for ( const n of keep ) if ( isUses( n.type ) && n.stack === svc.stack ) { g.setEdge( svc.id, n.id ); dashed.add( `${svc.id} ${n.id}` ); }

    dagre.layout( g );

    const boxes : ABox[] = [];
    const leaves : ALeaf[] = [];
    let internet : { x : number; y : number } | null = null;
    for ( const id of g.nodes() )
    {
        const p = g.node( id ) as { x : number; y : number; width : number; height : number } | undefined;
        if ( !p ) continue;
        if ( id === INTERNET ) { internet = { x: p.x, y: p.y }; continue; }
        if ( id.startsWith( "stk:" ) )
        {
            const stack : string = id.slice( 4 );
            boxes.push( { id, label: serviceOf( stack ), color: boxColor.get( stack ) ?? "#6e7681",
                          x: p.x - p.width / 2, y: p.y - p.height / 2, w: p.width, h: p.height } );
            continue;
        }
        const n : CloudNode | undefined = byId.get( id );
        if ( n ) leaves.push( { node: n, x: p.x, y: p.y } );
    }
    const edges : AEdge[] = g.edges().map( ( e ) => ( { d: smooth( ( g.edge( e ) as { points? : { x : number; y : number }[] } ).points ?? [] ), dashed: dashed.has( `${e.v} ${e.w}` ) } ) );

    return { boxes, leaves, internet, edges };
}

export function ArchView( { graph, selectedId, onSelect } : { graph : CloudGraph; selectedId : string | null; onSelect : ( id : string ) => void } )
{
    const arch : Arch = useMemo<Arch>( () => archLayout( graph ), [ graph ] );
    const [ view, setView ] = useState<ViewT>( { tx: 60, ty: 24, scale: 0.72 } );
    const drag = useRef<{ x : number; y : number; moved : boolean } | null>( null );
    const svgRef = useRef<SVGSVGElement | null>( null );

    const onWheel = ( e : React.WheelEvent ) : void =>
    {
        const rect : DOMRect | undefined = svgRef.current?.getBoundingClientRect();
        if ( !rect ) return;
        const cx : number = e.clientX - rect.left, cy : number = e.clientY - rect.top;
        setView( ( v ) =>
        {
            const next : number = Math.min( 2.5, Math.max( 0.2, v.scale * ( e.deltaY < 0 ? 1.1 : 0.9 ) ) );
            return { scale: next, tx: cx - ( cx - v.tx ) / v.scale * next, ty: cy - ( cy - v.ty ) / v.scale * next };
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

    return (
        <svg ref={svgRef} width="100%" height="100%"
             style={{ cursor: drag.current ? "grabbing" : "grab", display: "block" }}
             onWheel={onWheel} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}>
            <defs>
                <marker id="arch-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M0,0 L10,5 L0,10 z" fill="#484f58" />
                </marker>
            </defs>
            <g transform={`translate(${view.tx},${view.ty}) scale(${view.scale})`}>
                {/* per-service boxes (one per stack) */}
                {arch.boxes.map( ( b ) => (
                    <g key={b.id}>
                        <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={12} fill={b.color} fillOpacity={0.045} stroke={b.color} strokeOpacity={0.55} strokeWidth={1.5} />
                        <rect x={b.x} y={b.y} width={Math.min( b.w, 14 + b.label.length * 8 )} height={20} rx={6} fill={b.color} fillOpacity={0.16} />
                        <text x={b.x + 9} y={b.y + 14} fill={b.color} fontSize={12} fontWeight={800}>{b.label}</text>
                    </g>
                ) )}

                {/* edges: solid request-path, dashed data dependencies */}
                {arch.edges.map( ( e, i ) => (
                    <path key={i} d={e.d} fill="none" stroke={e.dashed ? "#3b434d" : "#586069"} strokeWidth={1.5}
                          strokeDasharray={e.dashed ? "4 4" : undefined} markerEnd={e.dashed ? undefined : "url(#arch-arrow)"} />
                ) )}

                {/* Internet entry point */}
                {arch.internet && (
                    <g transform={`translate(${arch.internet.x - 65},${arch.internet.y - NH / 2})`}>
                        <rect width={130} height={NH} rx={23} fill="#161b22" stroke="#5b9dff" strokeWidth={1.5} />
                        <foreignObject x={12} y={( NH - 24 ) / 2} width={24} height={24}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24 }}>
                                <CloudIcon style={{ color: "#5b9dff", fontSize: 20 }} />
                            </div>
                        </foreignObject>
                        <text x={44} y={28} fill="#e6edf3" fontSize={13} fontWeight={700}>Internet</text>
                    </g>
                )}

                {/* resource nodes */}
                {arch.leaves.map( ( { node, x, y } ) =>
                {
                    const { color, Icon } = awsStyle( node.type, node.category );
                    const sel : boolean = node.id === selectedId;
                    const it : number = ( NH - TILE ) / 2;
                    return (
                        <g key={node.id} transform={`translate(${x - NW / 2},${y - NH / 2})`} style={{ cursor: "pointer" }}
                           onClick={( ev ) => { ev.stopPropagation(); if ( !drag.current?.moved ) onSelect( node.id ); }}>
                            <title>{`${node.type}\n${shortName( node )}\n${node.stack}`}</title>
                            <rect width={NW} height={NH} rx={7} fill={sel ? color : "#161b22"} fillOpacity={sel ? 0.22 : 1} stroke={color} strokeWidth={sel ? 2.5 : 1.5} />
                            <rect x={it} y={it} width={TILE} height={TILE} rx={6} fill={color} />
                            <foreignObject x={it} y={it} width={TILE} height={TILE}>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: TILE, height: TILE }}>
                                    <Icon style={{ color: "#fff", fontSize: 19 }} />
                                </div>
                            </foreignObject>
                            <text x={it + TILE + 8} y={19} fill="#e6edf3" fontSize={12.5} fontWeight={700}>{trunc( node.typeLabel, 17 )}</text>
                            <text x={it + TILE + 8} y={35} fill="#8b949e" fontSize={10} fontFamily={MONO}>{trunc( shortName( node ), 18 )}</text>
                        </g>
                    );
                } )}
            </g>
        </svg>
    );
}
