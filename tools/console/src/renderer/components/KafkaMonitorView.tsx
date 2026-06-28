import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import NavigateBeforeIcon from "@mui/icons-material/NavigateBefore";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";

import type { MonitorEvent, MonitorState, MonitorSync, MonitorTopology } from "../../shared/types";
import { publisherOf, subscriberServicesOf } from "../../shared/monitorTopology";
import { api } from "../api";
import { MONO } from "../theme";

//
// KafkaMonitorView — the radial event monitor. Services sit on a ring; the Kafka bus is the hub at the
// center; every service↔hub line is a "pipe". A consumed event animates as a circle (colored by VERB,
// radius ∝ model-data size) flowing publisher→hub→subscriber(s). Click a service to see its live traffic
// stats; filter by noun (topic) and/or verb; pause to step through recent events; finished events drop
// into the Bin (they age out after the TTL). Pure SVG — no chart lib.
//

const VERBS : string[] = [ "created", "updated", "deleted", "purged", "accessed" ];
const VERB_COLOR : Record<string, string> =
{
    created: "#3fb950", updated: "#58a6ff", deleted: "#d29922", purged: "#f85149", accessed: "#a371f7",
};
function verbColor( verb : string ) : string { return VERB_COLOR[ verb ] ?? "#8b949e"; }

// circle radius encodes payload size (log-scaled) so fat model updates pop; always-present + intuitive.
function radiusFor( bytes : number ) : number
{
    if ( bytes <= 0 ) return 3;
    return Math.max( 3, Math.min( 16, 3 + Math.log10( bytes + 1 ) * 2.6 ) );
}

const VIEW_W : number = 1000, VIEW_H : number = 680;
const CX : number = 500, CY : number = 330, RING : number = 250, HUB_R : number = 34, NODE_R : number = 30;
const TTL_CHOICES : Array<{ label : string; ms : number }> =
[
    { label: "5 min", ms: 5 * 60_000 }, { label: "15 min", ms: 15 * 60_000 },
    { label: "30 min", ms: 30 * 60_000 }, { label: "60 min", ms: 60 * 60_000 },
];

interface Particle { id : number; fx : number; fy : number; tx : number; ty : number; start : number; dur : number; color : string; r : number; }
interface NodePos { id : string; x : number; y : number; }

export function KafkaMonitorView()
{
    const [ state, setState ]   = useState<MonitorState | null>( null );
    const [ events, setEvents ] = useState<Map<string, MonitorEvent>>( new Map() );

    const [ verbsOn, setVerbsOn ]   = useState<Set<string>>( new Set( VERBS ) );
    const [ topicsOn, setTopicsOn ] = useState<Set<string>>( new Set() );   // empty = all (seeded once topology arrives)
    const [ topicsSeeded, setTopicsSeeded ] = useState<boolean>( false );

    const [ paused, setPaused ]       = useState<boolean>( false );
    const [ selected, setSelected ]   = useState<string | null>( null );        // selected service id
    const [ selectedEvent, setSelectedEvent ] = useState<MonitorEvent | null>( null );
    const [ step, setStep ]           = useState<number>( 0 );                   // scrubber index (paused)

    const particles = useRef<Particle[]>( [] );
    const nextPid   = useRef<number>( 1 );
    const [ , setTick ] = useState<number>( 0 );                                 // RAF re-render pulse
    const pausedRef = useRef<boolean>( false );
    const filterRef = useRef<{ verbs : Set<string>; topics : Set<string> }>( { verbs: verbsOn, topics: topicsOn } );

    pausedRef.current = paused;
    filterRef.current = { verbs: verbsOn, topics: topicsOn };

    const topology : MonitorTopology | undefined = state?.topology;

    // node positions on the ring (memoized on topology)
    const nodes : NodePos[] = useMemo( () =>
    {
        const svc = topology?.services ?? [];
        return svc.map( ( s, i ) =>
        {
            const a : number = ( i / Math.max( 1, svc.length ) ) * Math.PI * 2 - Math.PI / 2;
            return { id: s.id, x: CX + Math.cos( a ) * RING, y: CY + Math.sin( a ) * RING };
        } );
    }, [ topology ] );
    const nodeAt = ( id : string ) : NodePos | undefined => nodes.find( ( n ) => n.id === id );

    // ── start the monitor + wire the live stream ──────────────────────────────────────────────────
    useEffect( () =>
    {
        let alive : boolean = true;
        void api.monitorStart().then( ( s : MonitorState ) =>
        {
            if ( !alive ) return;
            setState( s );
            setEvents( new Map( s.events.map( ( e ) => [ e.eventId, e ] ) ) );
            if ( !topicsSeeded ) { setTopicsOn( new Set( s.topology.topics ) ); setTopicsSeeded( true ); }
        } );

        const offEvent : () => void = api.onMonitorEvent( ( e : MonitorEvent ) =>
        {
            setEvents( ( prev ) => { const next = new Map( prev ); next.set( e.eventId, e ); return next; } );
            if ( !pausedRef.current ) spawnParticles( e );
        } );
        const offSync : () => void = api.onMonitorSync( ( sync : MonitorSync ) =>
        {
            setEvents( ( prev ) =>
            {
                const next = new Map( prev );
                for ( const d of sync.delivered )
                {
                    const ev = next.get( d.eventId );
                    if ( ev ) next.set( d.eventId, { ...ev, delivered: d.delivered, finishedAt: d.finishedAt } );
                }
                for ( const id of sync.removed ) next.delete( id );
                return next;
            } );
        } );

        return () => { alive = false; offEvent(); offSync(); void api.monitorStop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [] );

    // ── particle RAF loop ─────────────────────────────────────────────────────────────────────────
    useEffect( () =>
    {
        let raf : number = 0;
        const loop = () : void =>
        {
            const now : number = performance.now();
            particles.current = particles.current.filter( ( p ) => now - p.start < p.dur );
            if ( particles.current.length > 0 ) setTick( ( t ) => ( t + 1 ) % 1_000_000 );
            raf = requestAnimationFrame( loop );
        };
        raf = requestAnimationFrame( loop );
        return () => cancelAnimationFrame( raf );
    }, [] );

    // spawn a publisher→hub particle + a hub→subscriber particle per subscriber service (respecting filters)
    function spawnParticles( e : MonitorEvent ) : void
    {
        const f = filterRef.current;
        if ( !f.verbs.has( e.verb ) ) return;
        if ( f.topics.size > 0 && !f.topics.has( e.topic ) ) return;

        const color : string = verbColor( e.verb );
        const r : number = radiusFor( e.sizeBytes );
        const pub : NodePos | undefined = nodeAt( publisherOf( e.topic ) ?? e.publisher );
        const now : number = performance.now();

        if ( pub ) push( { id: nextPid.current++, fx: pub.x, fy: pub.y, tx: CX, ty: CY, start: now, dur: 900, color, r } );
        for ( const sid of subscriberServicesOf( e.topic ) )
        {
            const sub : NodePos | undefined = nodeAt( sid );
            if ( sub ) push( { id: nextPid.current++, fx: CX, fy: CY, tx: sub.x, ty: sub.y, start: now + 350, dur: 900, color, r } );
        }
    }
    function push( p : Particle ) : void
    {
        const arr = particles.current;
        arr.push( p );
        if ( arr.length > 400 ) arr.splice( 0, arr.length - 400 );   // cap
    }

    // ── derived collections ───────────────────────────────────────────────────────────────────────
    const all : MonitorEvent[] = useMemo( () => [ ...events.values() ], [ events ] );
    const visible : MonitorEvent[] = useMemo( () => all.filter( ( e ) =>
        verbsOn.has( e.verb ) && ( topicsOn.size === 0 || topicsOn.has( e.topic ) ) ), [ all, verbsOn, topicsOn ] );
    const live : MonitorEvent[] = useMemo( () => visible.filter( ( e ) => !e.finishedAt ), [ visible ] );
    const bin : MonitorEvent[]  = useMemo( () => visible.filter( ( e ) => e.finishedAt )
        .sort( ( a, b ) => ( b.finishedAt ?? 0 ) - ( a.finishedAt ?? 0 ) ), [ visible ] );
    const timeline : MonitorEvent[] = useMemo( () => [ ...visible ].sort( ( a, b ) => a.arrivedAt - b.arrivedAt ), [ visible ] );

    // per-service stats for the selected node
    const stats = useMemo( () =>
    {
        if ( !selected ) return null;
        const svc = topology?.services.find( ( s ) => s.id === selected );
        if ( !svc ) return null;
        const subTopics : Set<string> = new Set( svc.subscribes.map( ( b ) => b.topic ) );
        const mine : MonitorEvent[] = visible.filter( ( e ) => e.publisher === selected || subTopics.has( e.topic ) );
        const now : number = Date.now();
        const lastMin : number = mine.filter( ( e ) => now - e.arrivedAt < 60_000 ).length;
        const byVerb : Record<string, number> = {};
        const byTopic : Record<string, number> = {};
        let sizeSum : number = 0;
        for ( const e of mine ) { byVerb[ e.verb ] = ( byVerb[ e.verb ] ?? 0 ) + 1; byTopic[ e.topic ] = ( byTopic[ e.topic ] ?? 0 ) + 1; sizeSum += e.sizeBytes; }
        const last : MonitorEvent | undefined = [ ...mine ].sort( ( a, b ) => b.arrivedAt - a.arrivedAt )[ 0 ];
        return {
            svc, total: mine.length, ratePerMin: lastMin, byVerb, byTopic,
            avgSize: mine.length ? Math.round( sizeSum / mine.length ) : 0,
            published: mine.filter( ( e ) => e.publisher === selected ).length,
            consumed: mine.filter( ( e ) => subTopics.has( e.topic ) ).length,
            lastAt: last?.arrivedAt,
        };
    }, [ selected, visible, topology ] );

    // scrubber (paused): selecting a step highlights + inspects that event
    function gotoStep( i : number ) : void
    {
        const idx : number = Math.max( 0, Math.min( timeline.length - 1, i ) );
        setStep( idx );
        const e : MonitorEvent | undefined = timeline[ idx ];
        if ( e ) { setSelectedEvent( e ); spawnParticles( e ); }
    }

    function toggle( set : Set<string>, key : string, setter : ( s : Set<string> ) => void ) : void
    {
        const next = new Set( set );
        if ( next.has( key ) ) next.delete( key ); else next.add( key );
        setter( next );
    }

    async function onTtl( ms : number ) : Promise<void> { await api.monitorSetTtl( ms ); setState( ( s ) => s ? { ...s, ttlMs: ms } : s ); }
    async function onClear() : Promise<void> { await api.monitorClear(); setEvents( new Map() ); setSelectedEvent( null ); particles.current = []; }

    // ── render ──────────────────────────────────────────────────────────────────────────────────────
    return (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>

            {/* toolbar */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider", flexWrap: "wrap" }}>
                <Typography variant="subtitle2" sx={{ fontFamily: MONO }}>Kafka Events</Typography>
                <Chip size="small" variant="outlined"
                      color={state?.running ? "success" : state?.error ? "error" : "default"}
                      label={state?.error ? `bus: ${state.error}` : state?.running ? `bus: ${state.brokers}` : "connecting…"}
                      sx={{ fontFamily: MONO }} />
                <Box sx={{ flexGrow: 1 }} />
                <Chip size="small" label={`live ${live.length}`} sx={{ fontFamily: MONO }} />
                <Chip size="small" variant="outlined" label={`bin ${bin.length}`} sx={{ fontFamily: MONO }} />
                <Tooltip title="Bin TTL — events age out of the window after this">
                    <Select size="small" value={state?.ttlMs ?? 15 * 60_000} onChange={( e ) => void onTtl( Number( e.target.value ) )}
                            sx={{ fontFamily: MONO, fontSize: 12 }}>
                        {TTL_CHOICES.map( ( c ) => <MenuItem key={c.ms} value={c.ms} sx={{ fontFamily: MONO, fontSize: 12 }}>{c.label}</MenuItem> )}
                    </Select>
                </Tooltip>
                <Button size="small" startIcon={paused ? <PlayArrowIcon /> : <PauseIcon />} onClick={() => setPaused( !paused )}>
                    {paused ? "Live" : "Pause"}
                </Button>
                <Tooltip title="Clear the window"><IconButton size="small" onClick={() => void onClear()}><DeleteSweepIcon fontSize="small" /></IconButton></Tooltip>
            </Box>

            {/* filters: verbs (color) + nouns (topics) */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, px: 1.5, py: 0.75, borderBottom: "1px solid", borderColor: "divider", flexWrap: "wrap" }}>
                <Typography variant="caption" sx={{ color: "text.disabled", mr: 0.5 }}>verb</Typography>
                {VERBS.map( ( v ) => (
                    <Chip key={v} size="small" label={v}
                          onClick={() => toggle( verbsOn, v, setVerbsOn )}
                          variant={verbsOn.has( v ) ? "filled" : "outlined"}
                          sx={{ fontFamily: MONO, fontSize: 11, bgcolor: verbsOn.has( v ) ? verbColor( v ) : "transparent",
                                color: verbsOn.has( v ) ? "#0b0d12" : verbColor( v ), borderColor: verbColor( v ) }} />
                ) )}
                <Box sx={{ width: 12 }} />
                <Typography variant="caption" sx={{ color: "text.disabled", mr: 0.5 }}>noun</Typography>
                {( topology?.topics ?? [] ).map( ( t ) => (
                    <Chip key={t} size="small" label={t}
                          onClick={() => toggle( topicsOn, t, setTopicsOn )}
                          variant={topicsOn.has( t ) ? "filled" : "outlined"}
                          sx={{ fontFamily: MONO, fontSize: 11 }} />
                ) )}
            </Box>

            {/* scrubber (paused only) */}
            {paused && (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 0.5, borderBottom: "1px solid", borderColor: "divider" }}>
                    <IconButton size="small" onClick={() => gotoStep( step - 1 )}><NavigateBeforeIcon fontSize="small" /></IconButton>
                    <Box component="input" type="range" min={0} max={Math.max( 0, timeline.length - 1 )} value={Math.min( step, Math.max( 0, timeline.length - 1 ) )}
                         onChange={( e : ChangeEvent<HTMLInputElement> ) => gotoStep( Number( e.target.value ) )}
                         sx={{ flexGrow: 1 }} />
                    <IconButton size="small" onClick={() => gotoStep( step + 1 )}><NavigateNextIcon fontSize="small" /></IconButton>
                    <Typography variant="caption" sx={{ fontFamily: MONO, minWidth: 90, textAlign: "right" }}>
                        {timeline.length ? `${Math.min( step + 1, timeline.length )} / ${timeline.length}` : "0 / 0"}
                    </Typography>
                </Box>
            )}

            {/* graph + side panel */}
            <Box sx={{ display: "flex", flexGrow: 1, minHeight: 0 }}>
                <Box sx={{ flexGrow: 1, minWidth: 0, position: "relative" }}>
                    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width="100%" height="100%" style={{ display: "block" }}>
                        {/* pipes: service ↔ hub */}
                        {nodes.map( ( n ) => (
                            <line key={`pipe-${n.id}`} x1={n.x} y1={n.y} x2={CX} y2={CY}
                                  stroke={selected === n.id ? "#58a6ff" : "#30363d"} strokeWidth={selected === n.id ? 3 : 1.5}
                                  style={{ cursor: "pointer" }} onClick={() => { setSelected( n.id ); setSelectedEvent( null ); }} />
                        ) )}

                        {/* particles */}
                        {particles.current.map( ( p ) =>
                        {
                            const t : number = Math.max( 0, Math.min( 1, ( performance.now() - p.start ) / p.dur ) );
                            if ( performance.now() < p.start ) return null;
                            const x : number = p.fx + ( p.tx - p.fx ) * t, y : number = p.fy + ( p.ty - p.fy ) * t;
                            return <circle key={p.id} cx={x} cy={y} r={p.r} fill={p.color} opacity={0.9} />;
                        } )}

                        {/* hub */}
                        <circle cx={CX} cy={CY} r={HUB_R} fill="#161b22" stroke="#8b949e" strokeWidth={2} />
                        <text x={CX} y={CY + 4} textAnchor="middle" fontSize={13} fontFamily={MONO} fill="#c9d1d9">kafka</text>

                        {/* service nodes */}
                        {nodes.map( ( n ) => (
                            <g key={`node-${n.id}`} style={{ cursor: "pointer" }} onClick={() => { setSelected( n.id ); setSelectedEvent( null ); }}>
                                <circle cx={n.x} cy={n.y} r={NODE_R}
                                        fill={selected === n.id ? "#1f2937" : "#161b22"}
                                        stroke={selected === n.id ? "#58a6ff" : "#484f58"} strokeWidth={2} />
                                <text x={n.x} y={n.y + 4} textAnchor="middle" fontSize={12} fontFamily={MONO} fill="#c9d1d9">{n.id}</text>
                            </g>
                        ) )}
                    </svg>
                </Box>

                {/* side panel: event inspector → service stats → bin */}
                <Box sx={{ width: 360, flexShrink: 0, borderLeft: "1px solid", borderColor: "divider", display: "flex", flexDirection: "column", minHeight: 0 }}>
                    {selectedEvent ? (
                        <Box sx={{ p: 1.5, overflow: "auto" }}>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                                <Chip size="small" label={selectedEvent.verb || "—"} sx={{ bgcolor: verbColor( selectedEvent.verb ), color: "#0b0d12", fontFamily: MONO }} />
                                <Typography variant="subtitle2" sx={{ fontFamily: MONO }}>{selectedEvent.action}</Typography>
                                <Box sx={{ flexGrow: 1 }} />
                                <Button size="small" onClick={() => setSelectedEvent( null )}>close</Button>
                            </Box>
                            <Typography variant="caption" sx={{ color: "text.secondary", fontFamily: MONO, display: "block", mb: 1 }}>
                                {selectedEvent.publisher} → {( subscriberServicesOf( selectedEvent.topic ).join( ", " ) || "—" )} · {selectedEvent.sizeBytes} B ·
                                {selectedEvent.finishedAt ? " binned" : ` ${selectedEvent.delivered.length}/${selectedEvent.subscribers.length} delivered`}
                            </Typography>
                            <Box component="pre" sx={{ m: 0, p: 1, bgcolor: "#0a0d12", borderRadius: 1, fontFamily: MONO, fontSize: 11, color: "#e6edf3", overflow: "auto", maxHeight: "calc(100vh - 360px)" }}>
                                {JSON.stringify( selectedEvent.envelope, null, 2 )}
                            </Box>
                        </Box>
                    ) : stats ? (
                        <Box sx={{ p: 1.5, overflow: "auto" }}>
                            <Typography variant="subtitle2" sx={{ fontFamily: MONO, mb: 1 }}>{stats.svc.id} — traffic</Typography>
                            <StatRow k="events (window)" v={String( stats.total )} />
                            <StatRow k="rate (last min)" v={`${stats.ratePerMin}/min`} />
                            <StatRow k="published" v={String( stats.published )} />
                            <StatRow k="consumed" v={String( stats.consumed )} />
                            <StatRow k="avg size" v={`${stats.avgSize} B`} />
                            <StatRow k="last seen" v={stats.lastAt ? `${Math.round( ( Date.now() - stats.lastAt ) / 1000 )}s ago` : "—"} />
                            <Typography variant="caption" sx={{ color: "text.disabled", display: "block", mt: 1 }}>by verb</Typography>
                            {Object.entries( stats.byVerb ).map( ( [ v, n ] ) => (
                                <Box key={v} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                    <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: verbColor( v ) }} />
                                    <Typography variant="caption" sx={{ fontFamily: MONO }}>{v}: {n}</Typography>
                                </Box>
                            ) )}
                            <Typography variant="caption" sx={{ color: "text.disabled", display: "block", mt: 1 }}>by noun</Typography>
                            {Object.entries( stats.byTopic ).map( ( [ t, n ] ) => (
                                <Typography key={t} variant="caption" sx={{ fontFamily: MONO, display: "block" }}>{t}: {n}</Typography>
                            ) )}
                        </Box>
                    ) : (
                        <Box sx={{ p: 2 }}>
                            <Typography variant="caption" sx={{ color: "text.disabled" }}>
                                Click a service or a pipe for live traffic stats. Click a binned event to inspect its model data.
                            </Typography>
                        </Box>
                    )}

                    {/* bin */}
                    <Box sx={{ borderTop: "1px solid", borderColor: "divider", flexShrink: 0, maxHeight: "40%", display: "flex", flexDirection: "column", minHeight: 0 }}>
                        <Typography variant="caption" sx={{ px: 1.5, py: 0.5, color: "text.disabled", fontFamily: MONO }}>
                            Bin — consumed events ({bin.length}) · age out in {Math.round( ( state?.ttlMs ?? 0 ) / 60_000 )} min
                        </Typography>
                        <Box sx={{ overflow: "auto" }}>
                            {bin.map( ( e ) => (
                                <Box key={e.eventId} onClick={() => setSelectedEvent( e )}
                                     sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 0.4, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}>
                                    <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: verbColor( e.verb ), flexShrink: 0 }} />
                                    <Typography variant="caption" noWrap sx={{ fontFamily: MONO, fontSize: 11 }}>{e.action}</Typography>
                                    <Box sx={{ flexGrow: 1 }} />
                                    <Typography variant="caption" sx={{ color: "text.disabled", fontFamily: MONO, fontSize: 10 }}>{e.sizeBytes}B</Typography>
                                </Box>
                            ) )}
                            {bin.length === 0 && <Typography variant="caption" sx={{ px: 1.5, py: 1, color: "text.disabled", display: "block" }}>nothing consumed yet</Typography>}
                        </Box>
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}

function StatRow( { k, v } : { k : string; v : string } )
{
    return (
        <Box sx={{ display: "flex", justifyContent: "space-between", py: 0.25 }}>
            <Typography variant="caption" sx={{ color: "text.secondary", fontFamily: MONO }}>{k}</Typography>
            <Typography variant="caption" sx={{ fontFamily: MONO }}>{v}</Typography>
        </Box>
    );
}

export default KafkaMonitorView;
