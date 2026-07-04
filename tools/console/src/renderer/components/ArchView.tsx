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
interface Arch { boxes : Array<ABox>; leaves : Array<ALeaf>; internet : { x : number; y : number } | null; edges : Array<AEdge>; }

// resources too low-level / noisy to chart
const DENY : Array<RegExp> = [
    /^AWS::IAM::/, /^AWS::Logs::/, /^AWS::SSM::/, /^Custom::/, /^AWS::CDK::/, /Permission$/,
    /^AWS::ApiGatewayV2::(Route|Integration|Stage|Deployment)/,
    /^AWS::EC2::(SecurityGroup|Route$|RouteTable|SubnetRouteTableAssociation|VPCGatewayAttachment|SecurityGroupIngress|SecurityGroupEgress|VPCEndpoint)/,
];
/** True when a resource type should be charted (not on the DENY list of low-level/noisy types). */
const archKeep = ( type : string ) : boolean => !DENY.some( ( re ) => re.test( type ) );
// a service's data/integration dependencies — drawn with dashed edges from the service
const isUses   = ( type : string ) : boolean => /^AWS::(DynamoDB|S3|KMS|SecretsManager|SQS|SNS|Events|MSK|Scheduler|Cognito|OpenSearchService|SES|MediaConvert)::/.test( type );

/** "app-local" / "platform-staging" → "app" / "platform" (drop the env suffix for the box label). */
function serviceOf( stack : string ) : string
{
    return stack.replace( /-(local|dev|development|staging|production|prod)$/i, "" );
}

/** Smooth routed points into a bezier SVG path (Catmull-Rom → cubic bezier; rankdir is TB here). */
function smooth( points : { x : number; y : number }[] ) : string
{
    if ( points.length < 2 ) return "";
    // two points → a single vertical-ish cubic curve (rankdir is TB)
    if ( points.length === 2 ) { const midY : number = ( points[ 0 ].y + points[ 1 ].y ) / 2; return `M${points[ 0 ].x},${points[ 0 ].y} C${points[ 0 ].x},${midY} ${points[ 1 ].x},${midY} ${points[ 1 ].x},${points[ 1 ].y}`; }
    let path : string = `M${points[ 0 ].x},${points[ 0 ].y}`;
    for ( let index : number = 0; index < points.length - 1; index++ )
    {
        // prev / current / next / next-next, clamped at the ends — the four points the curve interpolates
        const prev = points[ index - 1 ] ?? points[ index ], curr = points[ index ], next = points[ index + 1 ], after = points[ index + 2 ] ?? next;
        path += ` C${curr.x + ( next.x - prev.x ) / 6},${curr.y + ( next.y - prev.y ) / 6} ${next.x - ( after.x - curr.x ) / 6},${next.y - ( after.y - curr.y ) / 6} ${next.x},${next.y}`;
    }
    return path;
}

/** Readable node subtitle: the physical name, unless it's an opaque ARN — then the logical id. */
function shortName( node : CloudNode ) : string
{
    const physicalId : string | undefined = node.physicalId;
    return !physicalId || physicalId.startsWith( "arn:" ) ? node.logicalId : physicalId;
}
/** Truncate `text` to at most `max` chars, appending an ellipsis when shortened. */
function trunc( text : string, max : number ) : string { return text.length > max ? text.slice( 0, max - 1 ) + "…" : text; }

/**
 * Lay out the architecture diagram with dagre (compound): one box per stack/service holding its
 * resource nodes, plus the Internet entry point, the solid request-path spine, and dashed data edges.
 */
function archLayout( graph : CloudGraph ) : Arch
{
    const keep : Array<CloudNode> = graph.nodes.filter( ( node ) => archKeep( node.type ) );
    const byId : Map<string, CloudNode> = new Map( keep.map( ( node ) => [ node.id, node ] ) );

    // one box per stack (= per service), platform last
    const stacks : Array<string> = [ ...new Set( keep.map( ( node ) => node.stack ) ) ]
        .sort( ( left, right ) => ( left.startsWith( "platform" ) ? 1 : 0 ) - ( right.startsWith( "platform" ) ? 1 : 0 ) || left.localeCompare( right ) );
    const boxColor : Map<string, string> = new Map( stacks.map( ( stack, index ) => [ stack, BOX_COLORS[ index % BOX_COLORS.length ] ] ) );

    // `graph`/the edge param below are left inferred: dagre's Graph is generic and annotating it fights
    // dagre.layout's GraphLabel constraint. Inference yields the correct types.
    const graphLayout = new dagre.graphlib.Graph( { compound: true } );
    graphLayout.setGraph( { rankdir: "TB", align: "UL", nodesep: 24, ranksep: 52, marginx: 24, marginy: 24 } );
    graphLayout.setDefaultEdgeLabel( () => ( {} ) );

    for ( const stack of stacks ) graphLayout.setNode( `stk:${stack}`, { label: serviceOf( stack ) } );
    for ( const node of keep ) { graphLayout.setNode( node.id, { width: NW, height: NH } ); graphLayout.setParent( node.id, `stk:${node.stack}` ); }
    graphLayout.setNode( INTERNET, { width: 130, height: NH } );

    // request-path spine
    const find = ( type : string ) : CloudNode | undefined => keep.find( ( node ) => node.type === type );
    const spine : Array<string> = [
        INTERNET,
        find( "AWS::ApiGatewayV2::Api" )?.id,
        find( "AWS::ApiGatewayV2::VpcLink" )?.id,
        find( "AWS::ElasticLoadBalancingV2::LoadBalancer" )?.id,
        find( "AWS::ECS::Service" )?.id,
    ].filter( Boolean ) as Array<string>;
    for ( let index : number = 0; index < spine.length - 1; index++ ) graphLayout.setEdge( spine[ index ], spine[ index + 1 ] );

    // dashed data edges from each ECS service to the resources it uses (same stack)
    const dashed : Set<string> = new Set();
    for ( const service of keep.filter( ( node ) => node.type === "AWS::ECS::Service" ) )
        for ( const node of keep ) if ( isUses( node.type ) && node.stack === service.stack ) { graphLayout.setEdge( service.id, node.id ); dashed.add( `${service.id} ${node.id}` ); }

    dagre.layout( graphLayout );

    const boxes : Array<ABox> = [];
    const leaves : Array<ALeaf> = [];
    let internet : { x : number; y : number } | null = null;
    for ( const id of graphLayout.nodes() )
    {
        const placement = graphLayout.node( id ) as { x : number; y : number; width : number; height : number } | undefined;
        if ( !placement ) continue;
        if ( id === INTERNET ) { internet = { x: placement.x, y: placement.y }; continue; }
        if ( id.startsWith( "stk:" ) )
        {
            // dagre reports box center; convert to a top-left origin for the rect
            const stack : string = id.slice( 4 );
            boxes.push( { id, label: serviceOf( stack ), color: boxColor.get( stack ) ?? "#6e7681",
                          x: placement.x - placement.width / 2, y: placement.y - placement.height / 2, w: placement.width, h: placement.height } );
            continue;
        }
        const node : CloudNode | undefined = byId.get( id );
        if ( node ) leaves.push( { node, x: placement.x, y: placement.y } );
    }
    const edges : Array<AEdge> = graphLayout.edges().map( ( edge ) => ( { d: smooth( ( graphLayout.edge( edge ) as { points? : { x : number; y : number }[] } ).points ?? [] ), dashed: dashed.has( `${edge.v} ${edge.w}` ) } ) );

    return { boxes, leaves, internet, edges };
}

/** The Architecture diagram SVG — renders the laid-out boxes/leaves/edges with pan + zoom. */
export function ArchView( { graph, selectedId, onSelect } : { graph : CloudGraph; selectedId : string | null; onSelect : ( id : string ) => void } )
{
    const arch : Arch = useMemo<Arch>( () => archLayout( graph ), [ graph ] );
    const [ view, setView ] = useState<ViewT>( { tx: 60, ty: 24, scale: 0.72 } );
    const drag = useRef<{ x : number; y : number; moved : boolean } | null>( null );
    const svgRef = useRef<SVGSVGElement | null>( null );

    /** Zoom toward the cursor: keep the world point under the pointer fixed as scale changes. */
    const onWheel = ( event : React.WheelEvent ) : void =>
    {
        const rect : DOMRect | undefined = svgRef.current?.getBoundingClientRect();
        if ( !rect ) return;
        const cursorX : number = event.clientX - rect.left, cursorY : number = event.clientY - rect.top;
        setView( ( prev ) =>
        {
            const next : number = Math.min( 2.5, Math.max( 0.2, prev.scale * ( event.deltaY < 0 ? 1.1 : 0.9 ) ) );
            return { scale: next, tx: cursorX - ( cursorX - prev.tx ) / prev.scale * next, ty: cursorY - ( cursorY - prev.ty ) / prev.scale * next };
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
                {arch.boxes.map( ( box ) => (
                    <g key={box.id}>
                        <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={12} fill={box.color} fillOpacity={0.045} stroke={box.color} strokeOpacity={0.55} strokeWidth={1.5} />
                        {/* label pill — width tracks the label length, capped at the box width */}
                        <rect x={box.x} y={box.y} width={Math.min( box.w, 14 + box.label.length * 8 )} height={20} rx={6} fill={box.color} fillOpacity={0.16} />
                        <text x={box.x + 9} y={box.y + 14} fill={box.color} fontSize={12} fontWeight={800}>{box.label}</text>
                    </g>
                ) )}

                {/* edges: solid request-path, dashed data dependencies */}
                {arch.edges.map( ( edge, index ) => (
                    <path key={index} d={edge.d} fill="none" stroke={edge.dashed ? "#3b434d" : "#586069"} strokeWidth={1.5}
                          strokeDasharray={edge.dashed ? "4 4" : undefined} markerEnd={edge.dashed ? undefined : "url(#arch-arrow)"} />
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
                    const selected : boolean = node.id === selectedId;
                    const iconTop : number = ( NH - TILE ) / 2;   // vertically center the icon tile in the node
                    return (
                        <g key={node.id} transform={`translate(${x - NW / 2},${y - NH / 2})`} style={{ cursor: "pointer" }}
                           onClick={( event ) => { event.stopPropagation(); if ( !drag.current?.moved ) onSelect( node.id ); }}>
                            <title>{`${node.type}\n${shortName( node )}\n${node.stack}`}</title>
                            <rect width={NW} height={NH} rx={7} fill={selected ? color : "#161b22"} fillOpacity={selected ? 0.22 : 1} stroke={color} strokeWidth={selected ? 2.5 : 1.5} />
                            <rect x={iconTop} y={iconTop} width={TILE} height={TILE} rx={6} fill={color} />
                            <foreignObject x={iconTop} y={iconTop} width={TILE} height={TILE}>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: TILE, height: TILE }}>
                                    <Icon style={{ color: "#fff", fontSize: 19 }} />
                                </div>
                            </foreignObject>
                            <text x={iconTop + TILE + 8} y={19} fill="#e6edf3" fontSize={12.5} fontWeight={700}>{trunc( node.typeLabel, 17 )}</text>
                            <text x={iconTop + TILE + 8} y={35} fill="#8b949e" fontSize={10} fontFamily={MONO}>{trunc( shortName( node ), 18 )}</text>
                        </g>
                    );
                } )}
            </g>
        </svg>
    );
}
