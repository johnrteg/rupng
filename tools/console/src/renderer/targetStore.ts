import { useSyncExternalStore } from "react";

import type { Target, TargetInfo } from "../shared/types";
import { TargetKind } from "../shared/types";
import { api } from "./api";

//
// Renderer-side target store — which cloud the SDK clients point at (LocalStack vs a named AWS
// profile/region) plus the read-only flag. A singleton so every surface (Monitor graph, Containers,
// Jobs invoke gating) agrees on the current target. Backed by the main process (aws.ts).
//

const INITIAL : TargetInfo = { target: { kind: TargetKind.LOCALSTACK }, readOnly: false, profiles: [], regions: [] };

class TargetStore
{
    private snapshot : TargetInfo = INITIAL;
    private listeners = new Set<() => void>();
    private loaded = false;

    subscribe = ( listener : () => void ) : () => void =>
    {
        this.listeners.add( listener );
        if ( !this.loaded ) { this.loaded = true; void this.load(); }
        return () => this.listeners.delete( listener );
    };

    getSnapshot = () : TargetInfo => this.snapshot;

    private emit() : void { for ( const listener of this.listeners ) listener(); }
    /** Replace the snapshot and notify subscribers. */
    private set( info : TargetInfo ) : void { this.snapshot = info; this.emit(); }

    /** Fetch the current target from main (called lazily on first subscribe). */
    async load() : Promise<void>
    {
        try { this.set( await api.targetGet() ); } catch { /* keep initial */ }
    }

    /** Switch the active target in main and adopt the resulting target info. */
    async setTarget( target : Target ) : Promise<void>
    {
        this.set( await api.targetSet( target ) );
    }
}

export const targetStore = new TargetStore();

/** Hook: subscribe to the current target info (re-renders on target/profile changes). */
export function useTarget() : TargetInfo
{
    return useSyncExternalStore( targetStore.subscribe, targetStore.getSnapshot );
}
