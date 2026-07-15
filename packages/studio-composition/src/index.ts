//
// @repo/studio-composition — the SHARED Studio video composition (React + Remotion). ONE component drives both
// the browser <Player> preview (imported by the web editor) AND the server-side Remotion/Chromium render
// (media-21.18), so preview == output exactly. The Remotion Root entry (registerRoot + <Composition>) lives in
// ./Root and is referenced by ENTRY_POINT for the render worker's bundler — it is intentionally NOT re-exported
// here (importing it triggers registerRoot as a side effect, which the web preview must not do).
//
export { StudioVideoComposition } from './StudioVideoComposition';
export { default } from './StudioVideoComposition';

/** The Remotion composition id registered in {@link ./Root} (what the render worker selects). */
export const COMPOSITION_ID : string = "studio";

/** The module specifier of the Remotion Root entry (registerRoot + <Composition>), for the render worker's
 *  `@remotion/bundler` `bundle({ entryPoint })`. The worker resolves this to a filesystem path (e.g. via
 *  `require.resolve`) at render time — kept a plain string so the package builds to CommonJS (no `import.meta`).
 *  NOTE (media-21.18 go-live): the bundler needs the TSX SOURCE, so the worker image must ship this package's
 *  `src/` (or a resolver that maps the specifier to it), not just the built `bin/`. */
export const ENTRY_POINT : string = "@repo/studio-composition/Root";
// eof
