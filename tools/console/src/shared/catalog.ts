//
// The static service catalog — labels, MUI icon names, role→port mappings, and blurbs for every
// deployable service. Mirrors @repo/cloud-manifest Ports + @repo/system Register.Service.
//
//   • `webproxy` is intentionally ABSENT — it's a local-only dev edge proxy, never built/deployed here.
//   • `platform` is ABSENT — it's an event-source pseudo-service, not a deployable process.
//
// This is the CATALOG (what *could* exist). The main process cross-references it with a filesystem
// scan of apps/core/* to compute live capabilities — so a spec-only service shows as "planned" and
// lights up automatically once it's scaffolded. A service dir with no catalog entry still appears
// (with a default icon + guessed port), so the console never hides a real service.
//

export interface CatalogEntry
{
    label : string;
    /** MUI icon component name (see renderer/icons.tsx). */
    icon : string;
    blurb : string;
    /** role → absolute local-dev port (from Ports.ts). */
    roles : Record<string, number>;
    /** Frontend SPA (web) — built/served differently; no container or /health. */
    frontend? : boolean;
}

export const CATALOG : Record<string, CatalogEntry> =
{
    app          : { label: "App",          icon: "Hub",              blurb: "BFF / front door — main + public roles", roles: { main: 8100, public: 8101 } },
    auth         : { label: "Auth",         icon: "VpnKey",           blurb: "Identity — reader + writer roles",        roles: { reader: 8110, writer: 8111 } },
    account      : { label: "Account",      icon: "AccountCircle",    blurb: "Accounts & billing",                      roles: { main: 8120 } },
    registration : { label: "Registration", icon: "HowToReg",         blurb: "Sign-up & onboarding",                    roles: { main: 8130 } },
    contact      : { label: "Contact",      icon: "Contacts",         blurb: "Contacts & lists",                        roles: { main: 8140 } },
    campaign     : { label: "Campaign",     icon: "Campaign",         blurb: "Campaign orchestration",                  roles: { main: 8150 } },
    workflow     : { label: "Workflow",     icon: "AccountTree",      blurb: "Automation & workflows",                  roles: { main: 8160 } },
    marketplace  : { label: "Marketplace",  icon: "Storefront",       blurb: "Marketplace & integrations",              roles: { main: 8170 } },
    texting      : { label: "Texting",      icon: "Textsms",          blurb: "SMS/MMS channel",                         roles: { main: 8180 } },
    email        : { label: "Email",        icon: "Email",            blurb: "Email channel",                           roles: { main: 8190 } },
    voice        : { label: "Voice",        icon: "Call",             blurb: "Voice channel (planned)",                 roles: { main: 8200 } },
    print        : { label: "Print",        icon: "Print",            blurb: "Print / direct mail channel",             roles: { main: 8210 } },
    social       : { label: "Social",       icon: "Share",            blurb: "Social channel",                          roles: { main: 8220 } },
    survey       : { label: "Survey",       icon: "Poll",             blurb: "Surveys & forms",                         roles: { main: 8230 } },
    media        : { label: "Media",        icon: "PermMedia",        blurb: "Media assets & storage",                  roles: { main: 8240 } },
    links        : { label: "Links",        icon: "Link",             blurb: "Short links & tracking",                  roles: { main: 8250 } },
    analytics    : { label: "Analytics",    icon: "Analytics",        blurb: "Analytics ingestion & insight",           roles: { main: 8260 } },
    report       : { label: "Report",       icon: "Assessment",       blurb: "Reporting",                               roles: { main: 8270 } },
    monitor      : { label: "Monitor",      icon: "MonitorHeart",     blurb: "Health & ops monitoring",                 roles: { main: 8280 } },
    audit        : { label: "Audit",        icon: "Gavel",            blurb: "Audit log",                               roles: { main: 8290 } },
    search       : { label: "Search",       icon: "Search",           blurb: "Search / indexing",                       roles: { main: 8300 } },
    realtime     : { label: "Realtime",     icon: "Bolt",             blurb: "Realtime push / WebSocket",               roles: { main: 8310 } },
    collab       : { label: "Collab",       icon: "Groups",           blurb: "Collaboration",                           roles: { main: 8320 } },
    web          : { label: "Web",          icon: "Language",         blurb: "React SPA (Vite dev server)",             roles: { main: 5173 }, frontend: true }
};

/** Order services appear in the top bar (groups related services; unknown ids append at the end). */
export const CATALOG_ORDER : string[] =
[
    "web", "app",
    "auth", "account", "registration",
    "contact", "campaign", "workflow", "marketplace",
    "texting", "email", "voice", "print", "social", "survey",
    "media", "links",
    "analytics", "report", "monitor", "audit", "search",
    "realtime", "collab"
];
