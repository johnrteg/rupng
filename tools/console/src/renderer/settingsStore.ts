import { useSyncExternalStore } from "react";

//
// Persisted user settings (localStorage). A tiny singleton like the other stores, so any surface can
// read settings and the Settings dialog can save them. First setting: the container-metrics history
// window (drives how many bins the CPU/memory charts span).
//

export type HistogramWindowMin = 15 | 30 | 45 | 60;

export interface Settings
{
    histogramWindowMin : HistogramWindowMin;
}

const KEY = "rupconsole.settings";
const DEFAULTS : Settings = { histogramWindowMin: 30 };

/** Read settings from localStorage, validating the window value and falling back to defaults. */
function load() : Settings
{
    try
    {
        const raw : string | null = localStorage.getItem( KEY );
        if ( !raw ) return DEFAULTS;
        const parsed : Partial<Settings> = JSON.parse( raw ) as Partial<Settings>;
        const win : HistogramWindowMin | undefined = parsed.histogramWindowMin;
        return { histogramWindowMin: ( win === 15 || win === 30 || win === 45 || win === 60 ) ? win : DEFAULTS.histogramWindowMin };
    }
    catch { return DEFAULTS; }
}

class SettingsStore
{
    private snapshot : Settings = load();
    private listeners = new Set<() => void>();

    subscribe = ( listener : () => void ) : () => void =>
    {
        this.listeners.add( listener );
        return () => this.listeners.delete( listener );
    };

    getSnapshot = () : Settings => this.snapshot;

    /** Persist + broadcast a new settings object. */
    save( next : Settings ) : void
    {
        this.snapshot = next;
        try { localStorage.setItem( KEY, JSON.stringify( next ) ); } catch { /* ignore */ }
        for ( const listener of this.listeners ) listener();
    }
}

export const settingsStore = new SettingsStore();

/** Hook: subscribe to the current persisted settings (re-renders when they change). */
export function useSettings() : Settings
{
    return useSyncExternalStore( settingsStore.subscribe, settingsStore.getSnapshot );
}
