import type { ConsoleApi } from "../preload";

//
// The preload bridge exposes its API on `window.api`. Declare it globally so the renderer gets the
// full ConsoleApi types (no `any`), then re-export a convenience handle.
//
declare global
{
    interface Window
    {
        api : ConsoleApi;
    }
}

export const api : ConsoleApi = window.api;
