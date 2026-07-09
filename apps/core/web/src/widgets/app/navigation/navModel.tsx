//
import { JSX } from "react";

import { Access } from "@repo/system";

import HomeOutlinedIcon         from '@mui/icons-material/HomeOutlined';
import CampaignOutlinedIcon     from '@mui/icons-material/CampaignOutlined';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import ForumOutlinedIcon        from '@mui/icons-material/ForumOutlined';
import ContactsOutlinedIcon     from '@mui/icons-material/ContactsOutlined';
import AssessmentOutlinedIcon   from '@mui/icons-material/AssessmentOutlined';
import BuildOutlinedIcon        from '@mui/icons-material/BuildOutlined';
import PermMediaOutlinedIcon    from '@mui/icons-material/PermMediaOutlined';
import StorefrontOutlinedIcon   from '@mui/icons-material/StorefrontOutlined';
import PersonOutlineOutlinedIcon from '@mui/icons-material/PersonOutlineOutlined';
import ApartmentOutlinedIcon    from '@mui/icons-material/ApartmentOutlined';
import HelpOutlineOutlinedIcon  from '@mui/icons-material/HelpOutlineOutlined';
import ChatBubbleOutlineOutlinedIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import SettingsOutlinedIcon     from '@mui/icons-material/SettingsOutlined';

//
// navModel — the single source of truth for the app's navigation tree. Both the NavigationBar (renders it,
// infers selection/expansion from the URL) and AppRouter (registers a page per routable item) import this,
// so adding a nav entry wires up the route + the menu in one place. Routes are plain paths; a parent WITH
// children has no route (it expands), a leaf/child has one.
//
export namespace navModel
{
    export interface Item
    {
        id        : string;
        label     : string;
        icon?     : JSX.Element;        // parents carry an icon
        route?    : string;            // navigable target (leaf/child); parents-with-children omit it
        badge?    : number;            // optional count pill
        minRole?  : Access.Role;       // minimum account role to SEE this item (omit = any signed-in user)
        children? : Array<Item>;
    }

    export interface Section
    {
        id       : string;
        title?   : string;
        minRole? : Access.Role;        // minimum role to see the whole section
        items    : Array<Item>;
    }

    // ── the tree ────────────────────────────────────────────────────────────────────────────────────
    export const SECTIONS : Array<Section> =
    [
        {
            id: "main", title: "Main", items:
            [
                { id: "dashboard",     label: "Dashboard",     icon: <HomeOutlinedIcon />,       route: "/dashboard" },
                { id: "campaigns",     label: "Campaigns",     icon: <CampaignOutlinedIcon />,   route: "/campaigns" },
                { id: "schedule",      label: "Schedule",      icon: <CalendarMonthOutlinedIcon />, route: "/schedule" },
                { id: "conversations", label: "Conversations", icon: <ForumOutlinedIcon />,      route: "/conversations", badge: 5 },
                { id: "contacts",      label: "Audience",      icon: <ContactsOutlinedIcon />,   children:
                    [
                        { id: "contacts.segments", label: "Segments", route: "/contacts/segments" },
                        { id: "contacts.contacts", label: "Contacts", route: "/contacts/list" },
                    ] },
                { id: "reports",       label: "Reports",       icon: <AssessmentOutlinedIcon />, children:
                    [
                        { id: "reports.submit",    label: "Submit",    route: "/reports/submit" },
                        { id: "reports.scheduled", label: "Scheduled", route: "/reports/scheduled" },
                        { id: "reports.download",  label: "Download",  route: "/reports/download" },
                    ] },
                { id: "media",         label: "Media",         icon: <PermMediaOutlinedIcon />, children:
                    [
                        { id: "media.library",   label: "Library",   route: "/media/library" },
                        { id: "media.browse",    label: "Browse",    route: "/media/browse" },
                        { id: "media.aigen",     label: "AI Gen",    route: "/media/ai-gen" },
                        { id: "media.studio",    label: "Studio",    route: "/media/studio" },
                        { id: "media.email-templates", label: "Email Templates", route: "/studio/email-templates" },
                        { id: "media.downloads", label: "Downloads", route: "/media/downloads" },
                    ] },
                { id: "tools",         label: "Tools",         icon: <BuildOutlinedIcon />,      children:
                    [
                        { id: "tools.shortener", label: "URL Shortener", route: "/tools/url-shortener" },
                        { id: "tools.workflows", label: "Workflows",     route: "/tools/workflows" },
                        { id: "tools.monitor",   label: "Monitor",       route: "/tools/monitor" },
                    ] },
                { id: "marketplace",   label: "Marketplace",   icon: <StorefrontOutlinedIcon />, children:
                    [
                        { id: "marketplace.settings", label: "Settings", route: "/marketplace/settings", minRole: Access.AccountRole.ACCOUNT },
                        { id: "marketplace.explore",  label: "Explore",  route: "/marketplace/explore" },
                    ] },
            ]
        },
    ];

    /** Profile — pinned to the bottom (just above Settings), expands downward like the main nav. */
    export const PROFILE : Item =
    {
        id: "profile", label: "Profile", icon: <PersonOutlineOutlinedIcon />, children:
        [
            { id: "profile.details",       label: "Details",       route: "/profile/details" },
            { id: "profile.security",      label: "Security",      route: "/profile/security" },
            { id: "profile.notifications", label: "Notifications", route: "/profile/notifications" },
            { id: "profile.display",       label: "Display",       route: "/profile/display" },
        ]
    };

    /** Account — pinned to the bottom (between Profile and Settings), expands downward like the main nav.
     *  Children are role-gated: Details for any member (USER), Billing for BILLING, Users for admins (ACCOUNT).
     *  A member below every child's minimum won't see the Account group at all. */
    export const ACCOUNT : Item =
    {
        id: "account", label: "Account", icon: <ApartmentOutlinedIcon />, children:
        [
            { id: "account.details",      label: "Details",      route: "/account/details",      minRole: Access.AccountRole.USER },
            { id: "account.branding",     label: "Branding",     route: "/account/branding",     minRole: Access.AccountRole.USER },
            { id: "account.billing",      label: "Billing",      route: "/account/billing",      minRole: Access.AccountRole.BILLING },
            { id: "account.users",        label: "Users",        route: "/account/users",        minRole: Access.AccountRole.ACCOUNT },
            { id: "account.sub-accounts", label: "Sub-Accounts", route: "/account/sub-accounts", minRole: Access.AccountRole.ACCOUNT },
        ]
    };

    /** Help — pinned footer leaf (above Settings). Stub page for now. */
    export const HELP : Item =
    {
        id: "help", label: "Help", icon: <HelpOutlineOutlinedIcon />, route: "/help",
    };

    /** Chat — pinned footer leaf (above Settings). It has NO route: clicking it TOGGLES the right-side chat
     *  panel (a persistent surface, like the nav) rather than navigating. The badge is a live presence count
     *  (how many account members are online) — a stub for now. */
    export const CHAT : Item =
    {
        id: "chat", label: "Chat", icon: <ChatBubbleOutlineOutlinedIcon />, badge: 0,
    };

    /** Settings — pinned to the bottom of the nav, expands downward like the main nav. */
    export const SETTINGS : Item =
    {
        id: "settings", label: "Settings", icon: <SettingsOutlinedIcon />, children:
        [
            { id: "settings.contacts",     label: "Contacts",     route: "/settings/contacts" },
            { id: "settings.registration", label: "Registration", route: "/settings/registration", minRole: Access.AccountRole.ACCOUNT },
            { id: "settings.api",          label: "API",          route: "/settings/api",          minRole: Access.AccountRole.ACCOUNT },
            { id: "settings.email",        label: "Email",        route: "/settings/email",        minRole: Access.AppRole.APPLICATION },   // platform email config — app/root staff
            { id: "settings.actions",      label: "Actions",      route: "/settings/actions",      minRole: Access.AppRole.APPLICATION },   // pending-action queue (verify/reset/…) — app/root staff
        ]
    };

    /** Every top-level group, including the pinned Profile + Account + Settings, for traversal. */
    function allItems() : Array<Item>
    {
        return [ ...SECTIONS.flatMap( ( s : Section ) => s.items ), PROFILE, ACCOUNT, HELP, CHAT, SETTINGS ];
    }

    /** Every routable page: its route + a breadcrumb title — "Parent : Child" for a child selection (e.g.
     *  "Profile : Security"), just the label for a top-level leaf. Used by the router to register a page each. */
    export function pages() : Array<{ route : string; title : string }>
    {
        const out : Array<{ route : string; title : string }> = [];
        for( const item of allItems() )
        {
            if( item.route ) out.push( { route: item.route, title: item.label } );
            for( const child of item.children ?? [] )
                if( child.route ) out.push( { route: child.route, title: `${ item.label } : ${ child.label }` } );
        }
        return out;
    }

    /** The item id selected for a given URL path (a leaf parent or a child whose route matches), or "". */
    export function selectedFor( path : string ) : string
    {
        for( const item of allItems() )
        {
            if( item.route === path ) return item.id;
            for( const child of item.children ?? [] ) if( child.route === path ) return child.id;
        }
        return "";
    }

    /** The parent id that should be expanded for a given URL path (when the match is a child), or "". */
    export function ancestorFor( path : string ) : string
    {
        for( const item of allItems() )
            for( const child of item.children ?? [] ) if( child.route === path ) return item.id;
        return "";
    }

    // ── role-driven visibility ─────────────────────────────────────────────────────────────────────
    /** Does `role` meet an item/section's minimum? (No minimum = visible to any signed-in user.) */
    function allows( role : Access.Role, min? : Access.Role ) : boolean
    {
        return min === undefined || Access.isAllowed( role, min );
    }

    /** Is `path` reachable by `role`? Finds the nav item/child whose route matches and checks its minimum
     *  (plus its parent's + section's). Unknown / non-nav routes return `true` (don't block). Used on account
     *  switch to decide whether to stay on the current page or fall back to the dashboard. */
    export function pathAllowed( role : Access.Role, path : string ) : boolean
    {
        for( const section of SECTIONS )
            for( const item of section.items )
            {
                if( item.route === path ) return allows( role, section.minRole ) && allows( role, item.minRole );
                for( const child of item.children ?? [] )
                    if( child.route === path ) return allows( role, section.minRole ) && allows( role, item.minRole ) && allows( role, child.minRole );
            }

        for( const item of [ PROFILE, ACCOUNT, SETTINGS ] )
        {
            if( item.route === path ) return allows( role, item.minRole );
            for( const child of item.children ?? [] )
                if( child.route === path ) return allows( role, item.minRole ) && allows( role, child.minRole );
        }

        return true;   // unknown / non-nav route (e.g. /dashboard root) — don't block
    }

    /** Filter one item for `role`: hidden if the role is too low; a parent whose children are all hidden is
     *  itself hidden; otherwise its visible children are returned. */
    export function itemFor( item : Item, role : Access.Role ) : Item | null
    {
        if( !allows( role, item.minRole ) ) return null;
        if( item.children && item.children.length > 0 )
        {
            const kids : Array<Item> = item.children.filter( ( c : Item ) => allows( role, c.minRole ) );
            return kids.length > 0 ? { ...item, children: kids } : null;
        }
        return item;
    }

    /** The sections visible to `role` — items (and their children) filtered, empty sections dropped. */
    export function sectionsFor( role : Access.Role ) : Array<Section>
    {
        return SECTIONS
            .filter( ( s : Section ) => allows( role, s.minRole ) )
            .map( ( s : Section ) => ( { ...s, items: s.items.map( ( i : Item ) => itemFor( i, role ) ).filter( ( i : Item | null ) : i is Item => i !== null ) } ) )
            .filter( ( s : Section ) => s.items.length > 0 );
    }
}

export default navModel;
