//
// Per-service "Auto:" settings, persisted in localStorage so the checkboxes survive tab/service
// switches and app restarts. Shared by the ActionToolbar (controls) and DevelopView (pushes the full
// set to the main build orchestrator). `BuildSettings` itself lives in shared/types (main needs it too).
//
import type { BuildSettings } from "../shared/types";
export type { BuildSettings };

const KEY = "rup.build";
// Default to local dev: run the service locally, auto-build on change. Docker/Deploy are LocalStack-only opt-ins.
const DEFAULTS : BuildSettings = { target: "local", build: true, docker: false, deploy: false };

/** Window event fired when any service's Auto settings change → DevelopView re-pushes the config. */
export const BUILD_SETTINGS_EVENT = "rup:build-settings";

function all() : Record<string, Partial<BuildSettings>>
{
    try { return JSON.parse( localStorage.getItem( KEY ) ?? "{}" ) as Record<string, Partial<BuildSettings>>; }
    catch { return {}; }
}

export function loadBuildSettings( service : string ) : BuildSettings
{
    return { ...DEFAULTS, ...( all()[ service ] ?? {} ) };
}

export function saveBuildSettings( service : string, s : BuildSettings ) : void
{
    try { const map = all(); map[ service ] = s; localStorage.setItem( KEY, JSON.stringify( map ) ); }
    catch { /* ignore */ }
    window.dispatchEvent( new Event( BUILD_SETTINGS_EVENT ) );
}

/** The full {service → settings} map for the given services (defaults applied) — pushed to main. */
export function allBuildSettings( serviceIds : string[] ) : Record<string, BuildSettings>
{
    const out : Record<string, BuildSettings> = {};
    for ( const id of serviceIds ) out[ id ] = loadBuildSettings( id );
    return out;
}
