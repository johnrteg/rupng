import { useSyncExternalStore } from "react";

import type { ContainerInfo } from "../shared/types";
import { TargetKind } from "../shared/types";
import { api } from "./api";
import { targetStore } from "./targetStore";
import { settingsStore } from "./settingsStore";

//
// Central container-metrics store — a singleton that polls `docker stats` for the WHOLE app session,
// independent of which tab is mounted. So CPU/memory history keeps accumulating (and threshold
// alerts keep firing) even when you're not on the Monitor → Containers view. Components subscribe via
// useSyncExternalStore; the Containers panel and the header alert both read from here.
//

const LOCAL_POLL_MS = 4000;     // docker stats — cheap, poll fast
const AWS_POLL_MS = 20000;      // CloudWatch — metered, poll slower
export const ALERT_THRESHOLD = 75;                                                // % CPU or memory → alert

/** Number of history bins for a window: window / poll-interval (the charts span this many slots). */
function binsFor( kind : TargetKind, windowMin : number ) : number
{
    const pollMs : number = kind === TargetKind.AWS ? AWS_POLL_MS : LOCAL_POLL_MS;
    return Math.max( 1, Math.round( ( windowMin * 60 * 1000 ) / pollMs ) );
}

const SOUND_KEY = "rupconsole.alertSound";

export interface MetricHistory { cpu : Array<number>; mem : Array<number>; }

export interface Breach { key : string; name : string; metric : "CPU" | "MEM"; value : number; }

export interface MetricsSnapshot
{
    containers : Array<ContainerInfo>;
    history : Map<string, MetricHistory>;
    breaches : Array<Breach>;
    error? : string;
    loaded : boolean;
    soundEnabled : boolean;
    threshold : number;
    /** number of chart bins for the current window + poll cadence (charts pad to this width). */
    bins : number;
    ts : number;
}

function loadSound() : boolean
{
    try { return localStorage.getItem( SOUND_KEY ) !== "off"; } catch { return true; }
}

class MetricsStore
{
    private snapshot : MetricsSnapshot =
    {
        containers: [], history: new Map(), breaches: [], loaded: false,
        soundEnabled: loadSound(), threshold: ALERT_THRESHOLD,
        bins: binsFor( TargetKind.LOCALSTACK, settingsStore.getSnapshot().histogramWindowMin ), ts: 0
    };

    private listeners = new Set<() => void>();
    private timer : ReturnType<typeof setInterval> | null = null;
    private polling = false;
    private started = false;
    private lastKind : TargetKind | null = null;
    private lastBins = 0;
    /** keys currently in breach (e.g. "abc:CPU") — for rising-edge beep detection. */
    private breaching = new Set<string>();
    private audioCtx : AudioContext | null = null;

    // ── external-store contract ─────────────────────────────────────────────────────────────────
    subscribe = ( listener : () => void ) : () => void =>
    {
        this.listeners.add( listener );
        this.start();
        return () => this.listeners.delete( listener );
    };

    getSnapshot = () : MetricsSnapshot => this.snapshot;

    private emit() : void { for ( const listener of this.listeners ) listener(); }

    // ── lifecycle ───────────────────────────────────────────────────────────────────────────────
    /** Begin polling (idempotent). Re-arms when the target (LocalStack/AWS) changes. */
    start() : void
    {
        if ( this.started ) return;
        this.started = true;
        targetStore.subscribe( () => this.rearm() );    // react to target switches (source + cadence)
        settingsStore.subscribe( () => this.rearm() );  // react to window changes (bins)
        this.rearm();
    }

    /** (Re)arm for the current target + window. Target change resets history; window change re-caps. */
    private rearm() : void
    {
        const kind : TargetKind = targetStore.getSnapshot().target.kind;
        const newBins : number = binsFor( kind, settingsStore.getSnapshot().histogramWindowMin );
        const kindChanged : boolean = kind !== this.lastKind;

        if ( kindChanged )
        {
            // source changed (docker containers ↔ ECS services) → drop history + reset cadence
            this.lastKind = kind;
            this.lastBins = newBins;
            this.snapshot = { ...this.snapshot, containers: [], history: new Map(), breaches: [], loaded: false, bins: newBins };
            this.breaching.clear();
            if ( this.timer ) clearInterval( this.timer );
            this.emit();
            void this.poll();
            this.timer = setInterval( () => { void this.poll(); }, kind === TargetKind.AWS ? AWS_POLL_MS : LOCAL_POLL_MS );
            return;
        }

        if ( newBins !== this.lastBins )
        {
            // window changed → keep data, re-cap each series to the new bin count
            this.lastBins = newBins;
            const history : Map<string, MetricHistory> = new Map<string, MetricHistory>();
            for ( const [ key, series ] of this.snapshot.history )
                history.set( key, { cpu: series.cpu.slice( -newBins ), mem: series.mem.slice( -newBins ) } );
            this.snapshot = { ...this.snapshot, history, bins: newBins };
            this.emit();
        }
    }

    setSound( on : boolean ) : void
    {
        try { localStorage.setItem( SOUND_KEY, on ? "on" : "off" ); } catch { /* ignore */ }
        this.snapshot = { ...this.snapshot, soundEnabled: on };
        this.emit();
    }

    toggleSound() : void { this.setSound( !this.snapshot.soundEnabled ); }

    // ── polling ─────────────────────────────────────────────────────────────────────────────────
    private async poll() : Promise<void>
    {
        if ( this.polling ) return;
        this.polling = true;
        try
        {
            // LocalStack → docker stats; AWS → ECS service metrics from CloudWatch (read-only)
            const aws : boolean = targetStore.getSnapshot().target.kind === TargetKind.AWS;
            const { containers, error } = aws ? await api.ecsMetrics() : await api.dockerContainers();

            // roll history forward (keep last 30 min per container; drop vanished ones)
            const history : Map<string, MetricHistory> = new Map<string, MetricHistory>();
            const breaches : Array<Breach> = [];
            const nowBreaching : Set<string> = new Set<string>();

            const cap : number = this.lastBins;
            // append a sample to a series, trimming to the most recent `cap` bins
            const pushSample = ( series : Array<number>, value : number ) : Array<number> =>
            {
                const next : Array<number> = [ ...series, value ];
                return next.length > cap ? next.slice( -cap ) : next;
            };

            for ( const container of containers )
            {
                const key : string = container.id || container.name;
                const prev : MetricHistory = this.snapshot.history.get( key ) ?? { cpu: [], mem: [] };
                const cpu : number = parseFloat( container.cpuPercent ?? "0" ) || 0;
                const mem : number = parseFloat( container.memPercent ?? "0" ) || 0;
                history.set( key, { cpu: pushSample( prev.cpu, cpu ), mem: pushSample( prev.mem, mem ) } );

                if ( cpu >= ALERT_THRESHOLD ) { breaches.push( { key, name: container.name, metric: "CPU", value: cpu } ); nowBreaching.add( `${key}:CPU` ); }
                if ( mem >= ALERT_THRESHOLD ) { breaches.push( { key, name: container.name, metric: "MEM", value: mem } ); nowBreaching.add( `${key}:MEM` ); }
            }

            // rising edge — a metric newly crossed the threshold this tick → beep (if enabled)
            const newBreach : boolean = [ ...nowBreaching ].some( ( breachKey : string ) => !this.breaching.has( breachKey ) );
            this.breaching = nowBreaching;

            this.snapshot = { containers, history, breaches, error, loaded: true, soundEnabled: this.snapshot.soundEnabled, threshold: ALERT_THRESHOLD, bins: this.lastBins, ts: Date.now() };
            if ( newBreach && this.snapshot.soundEnabled ) this.beep();
            this.emit();
        }
        finally
        {
            this.polling = false;
        }
    }

    // ── audible alert (Web Audio — no asset needed) ────────────────────────────────────────────
    private beep() : void
    {
        try
        {
            const ctx : AudioContext = this.audioCtx ??= new AudioContext();
            if ( ctx.state === "suspended" ) void ctx.resume();
            // two quick rising tones; `at` is the start offset (s) from now, with a short gain envelope
            const tone = ( freq : number, at : number ) : void =>
            {
                const oscillator : OscillatorNode = ctx.createOscillator();
                const gain : GainNode = ctx.createGain();
                oscillator.type = "sine";
                oscillator.frequency.value = freq;
                gain.gain.setValueAtTime( 0.0001, ctx.currentTime + at );
                gain.gain.exponentialRampToValueAtTime( 0.09, ctx.currentTime + at + 0.02 );
                gain.gain.exponentialRampToValueAtTime( 0.0001, ctx.currentTime + at + 0.16 );
                oscillator.connect( gain ); gain.connect( ctx.destination );
                oscillator.start( ctx.currentTime + at );
                oscillator.stop( ctx.currentTime + at + 0.18 );
            };
            tone( 740, 0 );
            tone( 988, 0.14 );
        }
        catch { /* audio unavailable — ignore */ }
    }
}

export const metricsStore = new MetricsStore();

/** Hook: subscribe to the live metrics snapshot (re-renders on each poll). */
export function useMetrics() : MetricsSnapshot
{
    return useSyncExternalStore( metricsStore.subscribe, metricsStore.getSnapshot );
}
