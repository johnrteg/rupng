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

const VERBS : Array<string> = [ "created", "updated", "deleted", "purged", "accessed" ];
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

// Top-level radial monitor component: wires the live bus stream, animates particles, and renders the
// ring graph, filters, scrubber, and side panel (event inspector / service stats / bin).
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

    const particles = useRef<Array<Particle>>( [] );
    const nextPid   = useRef<number>( 1 );
    const [ , setTick ] = useState<number>( 0 );                                 // RAF re-render pulse
    const pausedRef = useRef<boolean>( false );
    const filterRef = useRef<{ verbs : Set<string>; topics : Set<string> }>( { verbs: verbsOn, topics: topicsOn } );

    pausedRef.current = paused;
    filterRef.current = { verbs: verbsOn, topics: topicsOn };

    const topology : MonitorTopology | undefined = state?.topology;

    // Lay each service out as an evenly-spaced point on the ring; recomputed only when topology changes.
    const nodes : Array<NodePos> = useMemo( () =>
    {
        const services = topology?.services ?? [];
        return services.map( ( service, index ) =>
        {
            // Spread services evenly around the full circle (2π), starting at the top (−π/2).
            const angle : number = ( index / Math.max( 1, services.length ) ) * Math.PI * 2 - Math.PI / 2;
            return { id: service.id, x: CX + Math.cos( angle ) * RING, y: CY + Math.sin( angle ) * RING };
        } );
    }, [ topology ] );

    // Look up a laid-out ring position by service id.
    const nodeAt = ( id : string ) : NodePos | undefined => nodes.find( ( node ) => node.id === id );

    // ── start the monitor + wire the live stream ──────────────────────────────────────────────────
    useEffect( () =>
    {
        let alive : boolean = true;
        void api.monitorStart().then( ( initial : MonitorState ) =>
        {
            if ( !alive ) return;
            setState( initial );
            setEvents( new Map( initial.events.map( ( event ) => [ event.eventId, event ] ) ) );
            if ( !topicsSeeded ) { setTopicsOn( new Set( initial.topology.topics ) ); setTopicsSeeded( true ); }
        } );

        // New event from the bus: record it and (unless paused) animate its particles.
        const offEvent : () => void = api.onMonitorEvent( ( event : MonitorEvent ) =>
        {
            setEvents( ( prev ) => { const next = new Map( prev ); next.set( event.eventId, event ); return next; } );
            if ( !pausedRef.current ) spawnParticles( event );
        } );
        // Sync from the bus: patch delivery progress on existing events and drop aged-out ones.
        const offSync : () => void = api.onMonitorSync( ( sync : MonitorSync ) =>
        {
            setEvents( ( prev ) =>
            {
                const next = new Map( prev );
                for ( const delivery of sync.delivered )
                {
                    const existing : MonitorEvent | undefined = next.get( delivery.eventId );
                    if ( existing ) next.set( delivery.eventId, { ...existing, delivered: delivery.delivered, finishedAt: delivery.finishedAt } );
                }
                for ( const id of sync.removed ) next.delete( id );
                return next;
            } );
        } );

        return () => { alive = false; offEvent(); offSync(); void api.monitorStop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [] );

    // ── particle RAF loop ─────────────────────────────────────────────────────────────────────────
    // Every animation frame: drop expired particles, then nudge a render pulse while any remain in flight.
    useEffect( () =>
    {
        let raf : number = 0;
        const loop = () : void =>
        {
            const now : number = performance.now();
            particles.current = particles.current.filter( ( particle ) => now - particle.start < particle.dur );
            if ( particles.current.length > 0 ) setTick( ( tick ) => ( tick + 1 ) % 1_000_000 );
            raf = requestAnimationFrame( loop );
        };
        raf = requestAnimationFrame( loop );
        return () => cancelAnimationFrame( raf );
    }, [] );

    // Spawn a publisher→hub particle plus one hub→subscriber particle per subscriber, honoring the active filters.
    function spawnParticles( event : MonitorEvent ) : void
    {
        const filters : { verbs : Set<string>; topics : Set<string> } = filterRef.current;
        if ( !filters.verbs.has( event.verb ) ) return;
        if ( filters.topics.size > 0 && !filters.topics.has( event.topic ) ) return;

        const color : string = verbColor( event.verb );
        const radius : number = radiusFor( event.sizeBytes );
        const publisherNode : NodePos | undefined = nodeAt( publisherOf( event.topic ) ?? event.publisher );
        const now : number = performance.now();

        // Leg 1: publisher service flows inward to the hub.
        if ( publisherNode ) push( { id: nextPid.current++, fx: publisherNode.x, fy: publisherNode.y, tx: CX, ty: CY, start: now, dur: 900, color, r: radius } );
        // Leg 2: hub fans the event out to each subscriber, staggered slightly after the inbound leg.
        for ( const subscriberId of subscriberServicesOf( event.topic ) )
        {
            const subscriberNode : NodePos | undefined = nodeAt( subscriberId );
            if ( subscriberNode ) push( { id: nextPid.current++, fx: CX, fy: CY, tx: subscriberNode.x, ty: subscriberNode.y, start: now + 350, dur: 900, color, r: radius } );
        }
    }

    // Append a particle to the live pool, trimming the oldest entries to keep it bounded.
    function push( particle : Particle ) : void
    {
        const pool : Array<Particle> = particles.current;
        pool.push( particle );
        if ( pool.length > 400 ) pool.splice( 0, pool.length - 400 );   // cap
    }

    // ── derived collections ───────────────────────────────────────────────────────────────────────
    // All known events as a flat array.
    const all : Array<MonitorEvent> = useMemo( () => [ ...events.values() ], [ events ] );
    // Events passing the active verb + topic filters; everything below derives from this.
    const visible : Array<MonitorEvent> = useMemo( () => all.filter( ( event ) =>
        verbsOn.has( event.verb ) && ( topicsOn.size === 0 || topicsOn.has( event.topic ) ) ), [ all, verbsOn, topicsOn ] );
    // In-flight events (not yet consumed/binned).
    const live : Array<MonitorEvent> = useMemo( () => visible.filter( ( event ) => !event.finishedAt ), [ visible ] );
    // Consumed events, most-recently-finished first.
    const bin : Array<MonitorEvent>  = useMemo( () => visible.filter( ( event ) => event.finishedAt )
        .sort( ( a, b ) => ( b.finishedAt ?? 0 ) - ( a.finishedAt ?? 0 ) ), [ visible ] );
    // Chronological order for the paused scrubber.
    const timeline : Array<MonitorEvent> = useMemo( () => [ ...visible ].sort( ( a, b ) => a.arrivedAt - b.arrivedAt ), [ visible ] );

    // Aggregate traffic stats for the selected service: counts, rate, per-verb/per-topic breakdowns, avg size.
    const stats = useMemo( () =>
    {
        if ( !selected ) return null;
        const service = topology?.services.find( ( candidate ) => candidate.id === selected );
        if ( !service ) return null;
        const subscribedTopics : Set<string> = new Set( service.subscribes.map( ( binding ) => binding.topic ) );
        // Events this service touches — ones it publishes plus ones it subscribes to.
        const mine : Array<MonitorEvent> = visible.filter( ( event ) => event.publisher === selected || subscribedTopics.has( event.topic ) );
        const now : number = Date.now();
        const lastMinuteCount : number = mine.filter( ( event ) => now - event.arrivedAt < 60_000 ).length;
        const byVerb : Record<string, number> = {};
        const byTopic : Record<string, number> = {};
        let sizeSum : number = 0;
        // Tally each event into the verb/topic histograms and accumulate total payload size.
        for ( const event of mine ) { byVerb[ event.verb ] = ( byVerb[ event.verb ] ?? 0 ) + 1; byTopic[ event.topic ] = ( byTopic[ event.topic ] ?? 0 ) + 1; sizeSum += event.sizeBytes; }
        const lastEvent : MonitorEvent | undefined = [ ...mine ].sort( ( a, b ) => b.arrivedAt - a.arrivedAt )[ 0 ];
        return {
            svc: service, total: mine.length, ratePerMin: lastMinuteCount, byVerb, byTopic,
            avgSize: mine.length ? Math.round( sizeSum / mine.length ) : 0,
            published: mine.filter( ( event ) => event.publisher === selected ).length,
            consumed: mine.filter( ( event ) => subscribedTopics.has( event.topic ) ).length,
            lastAt: lastEvent?.arrivedAt,
        };
    }, [ selected, visible, topology ] );

    // Move the paused scrubber to a timeline index (clamped), then inspect + replay that event.
    function gotoStep( requestedIndex : number ) : void
    {
        const index : number = Math.max( 0, Math.min( timeline.length - 1, requestedIndex ) );
        setStep( index );
        const event : MonitorEvent | undefined = timeline[ index ];
        if ( event ) { setSelectedEvent( event ); spawnParticles( event ); }
    }

    // Flip a key's membership in a string-set filter and push the new set through its setter.
    function toggle( set : Set<string>, key : string, setter : ( next : Set<string> ) => void ) : void
    {
        const next : Set<string> = new Set( set );
        if ( next.has( key ) ) next.delete( key ); else next.add( key );
        setter( next );
    }

    // Persist a new bin TTL to the backend and optimistically reflect it in local state.
    async function onTtl( ms : number ) : Promise<void> { await api.monitorSetTtl( ms ); setState( ( prev ) => prev ? { ...prev, ttlMs: ms } : prev ); }
    // Clear the whole window: drop all events, deselect, and wipe in-flight particles.
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
                    <Select size="small" value={state?.ttlMs ?? 15 * 60_000} onChange={( event ) => void onTtl( Number( event.target.value ) )}
                            sx={{ fontFamily: MONO, fontSize: 12 }}>
                        {TTL_CHOICES.map( ( choice ) => <MenuItem key={choice.ms} value={choice.ms} sx={{ fontFamily: MONO, fontSize: 12 }}>{choice.label}</MenuItem> )}
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
                {VERBS.map( ( verb ) => (
                    <Chip key={verb} size="small" label={verb}
                          onClick={() => toggle( verbsOn, verb, setVerbsOn )}
                          variant={verbsOn.has( verb ) ? "filled" : "outlined"}
                          sx={{ fontFamily: MONO, fontSize: 11, bgcolor: verbsOn.has( verb ) ? verbColor( verb ) : "transparent",
                                color: verbsOn.has( verb ) ? "#0b0d12" : verbColor( verb ), borderColor: verbColor( verb ) }} />
                ) )}
                <Box sx={{ width: 12 }} />
                <Typography variant="caption" sx={{ color: "text.disabled", mr: 0.5 }}>noun</Typography>
                {( topology?.topics ?? [] ).map( ( topic ) => (
                    <Chip key={topic} size="small" label={topic}
                          onClick={() => toggle( topicsOn, topic, setTopicsOn )}
                          variant={topicsOn.has( topic ) ? "filled" : "outlined"}
                          sx={{ fontFamily: MONO, fontSize: 11 }} />
                ) )}
            </Box>

            {/* scrubber (paused only) */}
            {paused && (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 0.5, borderBottom: "1px solid", borderColor: "divider" }}>
                    <IconButton size="small" onClick={() => gotoStep( step - 1 )}><NavigateBeforeIcon fontSize="small" /></IconButton>
                    <Box component="input" type="range" min={0} max={Math.max( 0, timeline.length - 1 )} value={Math.min( step, Math.max( 0, timeline.length - 1 ) )}
                         onChange={( event : ChangeEvent<HTMLInputElement> ) => gotoStep( Number( event.target.value ) )}
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
                        {/* pipes: service ↔ hub. Each pipe is TWO overlaid lines — a slightly thicker
                            visible bar, plus a wide transparent "hit-area" line so it's easy to click
                            without making the diagram heavy. */}
                        {nodes.map( ( node ) => (
                            <g key={`pipe-${node.id}`}>
                                <line x1={node.x} y1={node.y} x2={CX} y2={CY}
                                      stroke="transparent" strokeWidth={16} strokeLinecap="round"
                                      style={{ cursor: "pointer" }} onClick={() => { setSelected( node.id ); setSelectedEvent( null ); }} />
                                <line x1={node.x} y1={node.y} x2={CX} y2={CY}
                                      stroke={selected === node.id ? "#58a6ff" : "#30363d"} strokeWidth={selected === node.id ? 4 : 2.5}
                                      strokeLinecap="round" pointerEvents="none" />
                            </g>
                        ) )}

                        {/* particles */}
                        {particles.current.map( ( particle ) =>
                        {
                            // Normalized progress along this particle's leg (0 at start → 1 at end).
                            const progress : number = Math.max( 0, Math.min( 1, ( performance.now() - particle.start ) / particle.dur ) );
                            if ( performance.now() < particle.start ) return null;   // staggered leg not yet started
                            // Linear interpolation from the from-point (f) to the to-point (t).
                            const x : number = particle.fx + ( particle.tx - particle.fx ) * progress, y : number = particle.fy + ( particle.ty - particle.fy ) * progress;
                            return <circle key={particle.id} cx={x} cy={y} r={particle.r} fill={particle.color} opacity={0.9} />;
                        } )}

                        {/* hub */}
                        <circle cx={CX} cy={CY} r={HUB_R} fill="#161b22" stroke="#8b949e" strokeWidth={2} />
                        <text x={CX} y={CY + 4} textAnchor="middle" fontSize={13} fontFamily={MONO} fill="#c9d1d9">kafka</text>

                        {/* service nodes */}
                        {nodes.map( ( node ) => (
                            <g key={`node-${node.id}`} style={{ cursor: "pointer" }} onClick={() => { setSelected( node.id ); setSelectedEvent( null ); }}>
                                <circle cx={node.x} cy={node.y} r={NODE_R}
                                        fill={selected === node.id ? "#1f2937" : "#161b22"}
                                        stroke={selected === node.id ? "#58a6ff" : "#484f58"} strokeWidth={2} />
                                <text x={node.x} y={node.y + 4} textAnchor="middle" fontSize={12} fontFamily={MONO} fill="#c9d1d9">{node.id}</text>
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
                            <StatRow label="events (window)" value={String( stats.total )} />
                            <StatRow label="rate (last min)" value={`${stats.ratePerMin}/min`} />
                            <StatRow label="published" value={String( stats.published )} />
                            <StatRow label="consumed" value={String( stats.consumed )} />
                            <StatRow label="avg size" value={`${stats.avgSize} B`} />
                            <StatRow label="last seen" value={stats.lastAt ? `${Math.round( ( Date.now() - stats.lastAt ) / 1000 )}s ago` : "—"} />
                            <Typography variant="caption" sx={{ color: "text.disabled", display: "block", mt: 1 }}>by verb</Typography>
                            {Object.entries( stats.byVerb ).map( ( [ verb, count ] ) => (
                                <Box key={verb} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                    <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: verbColor( verb ) }} />
                                    <Typography variant="caption" sx={{ fontFamily: MONO }}>{verb}: {count}</Typography>
                                </Box>
                            ) )}
                            <Typography variant="caption" sx={{ color: "text.disabled", display: "block", mt: 1 }}>by noun</Typography>
                            {Object.entries( stats.byTopic ).map( ( [ topic, count ] ) => (
                                <Typography key={topic} variant="caption" sx={{ fontFamily: MONO, display: "block" }}>{topic}: {count}</Typography>
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
                            {bin.map( ( event ) => (
                                <Box key={event.eventId} onClick={() => setSelectedEvent( event )}
                                     sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 0.4, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}>
                                    <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: verbColor( event.verb ), flexShrink: 0 }} />
                                    <Typography variant="caption" noWrap sx={{ fontFamily: MONO, fontSize: 11 }}>{event.action}</Typography>
                                    <Box sx={{ flexGrow: 1 }} />
                                    <Typography variant="caption" sx={{ color: "text.disabled", fontFamily: MONO, fontSize: 10 }}>{event.sizeBytes}B</Typography>
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

// A single label/value row in the service stats panel.
function StatRow( { label, value } : { label : string; value : string } )
{
    return (
        <Box sx={{ display: "flex", justifyContent: "space-between", py: 0.25 }}>
            <Typography variant="caption" sx={{ color: "text.secondary", fontFamily: MONO }}>{label}</Typography>
            <Typography variant="caption" sx={{ fontFamily: MONO }}>{value}</Typography>
        </Box>
    );
}

export default KafkaMonitorView;
