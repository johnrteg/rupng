import { useSyncExternalStore } from "react";

import type { Target, TargetInfo } from "../shared/types";
import { api } from "./api";

//
// Renderer-side target store — which cloud the SDK clients point at (LocalStack vs a named AWS
// profile/region) plus the read-only flag. A singleton so every surface (Monitor graph, Containers,
// Jobs invoke gating) agrees on the current target. Backed by the main process (aws.ts).
//

const INITIAL : TargetInfo = { target: { kind: "localstack" }, readOnly: false, profiles: [], regions: [] };

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

    private emit() : void { for ( const l of this.listeners ) l(); }
    private set( info : TargetInfo ) : void { this.snapshot = info; this.emit(); }

    async load() : Promise<void>
    {
        try { this.set( await api.targetGet() ); } catch { /* keep initial */ }
    }

    async setTarget( t : Target ) : Promise<void>
    {
        this.set( await api.targetSet( t ) );
    }
}

export const targetStore = new TargetStore();

export function useTarget() : TargetInfo
{
    return useSyncExternalStore( targetStore.subscribe, targetStore.getSnapshot );
}
