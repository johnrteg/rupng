//
// Ports — the canonical service → local port registry (ONE source of truth, absolute numbers).
//
// A service may run 1..N concrete roles (e.g. app = Main + Public; auth = Reader + Writer), each a
// separate process that needs its own local port. Every role has an ABSOLUTE, NAMED port here —
// `Ports.APP.MAIN`, `Ports.AUTH.WRITER`. Both sides import the SAME named constant:
//   • the Service base — the role's default local-dev port (`super(id, Ports.APP.MAIN)`)
//   • the service's CloudManifest — the ECS `containerPort` (`containerPort: Ports.APP.MAIN`)
// so a port lives in exactly one place; change it once and both sides move together. There is NO
// relative offset/index to keep in sync (the old `base + offset` scheme let the two drift apart).
//
// This default is for LOCAL dev (the whole fleet boots collision-free on one host). On deploy the
// container/Lambda injects `PORT`, which ALWAYS WINS (Service precedence: env PORT → this default → 8000).
//
// LAYOUT: each service owns a BLOCK of 10 ports (8100, 8110, 8120, …) and manages role assignment
// WITHIN its own block below. 10 is headroom — most services use 1-2. Keeping every number in this
// one file is the "universal context": a collision is visible at a glance, and nothing outside a
// service's block is touched when it adds a role. Keep these STABLE — a change re-points that role's
// dev URL + proxy target; treat a reassignment as a reviewed change.
//
// ── Reserved (NOT services — documented so a block never reassigns them) ──────────────────────────
//   5173  web SPA — the Vite dev server (apps/core/web)
//   8080  WEBPROXY — the dev proxy that serves the SPA + forwards API prefixes (apps/core/webproxy)
//   8000  framework fallback — Service's default-of-last-resort (used only if no port is given).
//
export namespace Ports
{
    /** Ports reserved per service block — bases stride this far apart (8100, 8110, …). Headroom only. */
    export const BLOCK = 10;

    export const WEBPROXY = 8080;   // dev proxy (single port; serves SPA + proxies APIs)

    // Each block is a service's own range; it names its roles' absolute ports inside it. A single-role
    // service uses MAIN by convention. Adding a role here never affects another block.

    // ── BFF / front door — 8100 ──────────────────────────────────────────────
    export namespace APP          { export const MAIN = 8100; export const PUBLIC = 8101; }

    // ── identity / account ───────────────────────────────────────────────────
    export namespace AUTH         { export const MAIN = 8110; export const READER = 8111; export const WRITER = 8112; }
    export namespace ACCOUNT      { export const MAIN = 8120; export const READ = 8121; }
    export namespace REGISTRATION { export const MAIN = 8130; }

    // ── contacts / orchestration ─────────────────────────────────────────────
    export namespace CONTACT      { export const MAIN = 8140; }
    export namespace CAMPAIGN     { export const MAIN = 8150; }
    export namespace WORKFLOW     { export const MAIN = 8160; }
    export namespace MARKETPLACE  { export const MAIN = 8170; }

    // ── channels ─────────────────────────────────────────────────────────────
    export namespace TEXTING      { export const MAIN = 8180; }
    export namespace EMAIL        { export const MAIN = 8190; }
    export namespace VOICE        { export const MAIN = 8200; }   // planned
    export namespace PRINT        { export const MAIN = 8210; }
    export namespace SOCIAL       { export const MAIN = 8220; }
    export namespace SURVEY       { export const MAIN = 8230; }

    // ── assets / links ───────────────────────────────────────────────────────
    export namespace MEDIA        { export const MAIN = 8240; }
    export namespace LINKS        { export const MAIN = 8250; }

    // ── insight / ops ────────────────────────────────────────────────────────
    export namespace ANALYTICS    { export const MAIN = 8260; }
    export namespace REPORT       { export const MAIN = 8270; }
    export namespace MONITOR      { export const MAIN = 8280; }
    export namespace AUDIT        { export const MAIN = 8290; }
    export namespace SEARCH       { export const MAIN = 8300; }

    // ── realtime / collaboration ─────────────────────────────────────────────
    export namespace REALTIME     { export const MAIN = 8310; }
    export namespace COLLAB       { export const MAIN = 8320; }
}

export default Ports;
// eof
