//
// EmailTemplate — a versioned email template authored in the Studio email editor (email-2). The editor builds a
// JSON block tree (custom React components), which maps to MJML, which compiles to responsive HTML. All three
// representations are stored (S3 body + DynamoDB frontend, VERSION-controlled like media): JSON is the editable
// source of truth, MJML the portable intermediate, HTML the send-time output. A template targets a
// NotificationType case (1-of-many; one PUBLISHED/active per (scope, notificationType)) or is a free campaign
// template. Media library assets (images) and a color PALETTE feed the editor.
//
import { Email } from "./Email";

export namespace EmailTemplate
{
    /** Re-export so callers reference one NotificationType (defined in {@link Email}). */
    export type NotificationType = Email.NotificationType;

    /** Whether a template belongs to the PLATFORM (system mail — reset/verification, ROOT-managed) or an ACCOUNT. */
    export enum Scope { SYSTEM = "system", ACCOUNT = "account" }

    /** Lifecycle: DRAFT (editable) → PUBLISHED (active for its case; sendable) → ARCHIVED (retired, kept for history). */
    export enum Status { DRAFT = "draft", PUBLISHED = "published", ARCHIVED = "archived" }

    /** The kinds of block the editor composes — the full MJML body component set (each maps 1:1 to an MJML
     *  element). A closed set → enum. Every block also carries a generic {@link Block.attrs} bag so ANY MJML
     *  attribute (not just the editor's dedicated fields) can be set without extending this enum. */
    export enum BlockType
    {
        // ── layout containers ──
        SECTION           = "section",            // mj-section (a horizontal band; holds columns; supports background-url)
        COLUMN            = "column",             // mj-column (a vertical cell inside a section)
        GROUP             = "group",              // mj-group (columns that DON'T stack on mobile — stay side by side)
        WRAPPER           = "wrapper",            // mj-wrapper (wraps sections to share a background / full-width band)
        HERO              = "hero",               // mj-hero (a banner with a background image + overlaid content)
        // ── content ──
        TEXT              = "text",               // mj-text (rich text / merge tags)
        IMAGE             = "image",              // mj-image (a media library asset)
        BUTTON            = "button",             // mj-button (a tracked CTA link)
        DIVIDER           = "divider",            // mj-divider
        SPACER            = "spacer",             // mj-spacer
        TABLE             = "table",              // mj-table (raw table markup inside)
        // ── social / navigation ──
        SOCIAL            = "social",             // mj-social (holds social elements)
        SOCIAL_ELEMENT    = "socialElement",      // mj-social-element (one network icon/link)
        NAVBAR            = "navbar",              // mj-navbar (holds nav links)
        NAVBAR_LINK       = "navbarLink",          // mj-navbar-link (one nav link)
        // ── interactive ──
        ACCORDION         = "accordion",          // mj-accordion (holds accordion elements)
        ACCORDION_ELEMENT = "accordionElement",   // mj-accordion-element (title + collapsible text)
        CAROUSEL          = "carousel",           // mj-carousel (holds carousel images)
        CAROUSEL_IMAGE    = "carouselImage",      // mj-carousel-image (one slide)
        // ── escape hatch ──
        HTML              = "html",               // mj-raw (raw HTML passthrough, sanitized)
    }

    /** One node of the editable block tree. `props` are the editor's convenience fields (text/html content,
     *  src, href, colors …) mapped to the block's MJML element; `attrs` is a GENERIC MJML-attribute bag applied
     *  verbatim to the element (so any documented MJML attribute is settable from the editor's Attributes panel —
     *  it overrides a dedicated prop of the same name); `children` nest (section → columns → content). Kept loose
     *  (`unknown` prop values) so the editor + MJML mapper own the per-type shape without churning this contract. */
    export interface Block
    {
        id        : string;
        type      : BlockType;
        props?    : Record<string, unknown>;
        attrs?    : Record<string, string>;   // generic MJML attributes (verbatim), e.g. { "padding": "0", "css-class": "x" }
        children? : Array<Block>;
    }

    /** A named default-attribute group applied in `mj-head` → `mj-attributes` (e.g. component "all" → mj-all,
     *  "text" → mj-text) or a reusable `mj-class` definition (referenced via a block's `mj-class` attr). */
    export interface AttributeDefault { component : string; attrs : Record<string, string>; }
    /** A reusable `mj-class` (attributes applied to any block whose `attrs["mj-class"]` names it). */
    export interface AttributeClass { name : string; attrs : Record<string, string>; }
    /** A custom web font pulled into the email (mj-font). */
    export interface FontDef { name : string; href : string; }

    /** Document HEAD (`mj-head`) settings — the parts of MJML that live outside the body: preview/inbox text,
     *  document title, the responsive breakpoint, imported fonts, global component defaults + reusable classes,
     *  and raw `mj-style` CSS blocks. All optional; each maps to its `mj-*` head element. */
    export interface Head
    {
        preview?    : string;                    // mj-preview (inbox preview snippet)
        title?      : string;                    // mj-title (document <title>)
        breakpoint? : string;                    // mj-breakpoint width, e.g. "480px" (below this columns stack)
        fonts?      : Array<FontDef>;             // mj-font imports
        defaults?   : Array<AttributeDefault>;   // mj-attributes → per-component defaults (mj-all, mj-text, …)
        classes?    : Array<AttributeClass>;     // mj-attributes → mj-class definitions
        styles?     : Array<string>;             // mj-style raw CSS blocks
    }

    /** Document-level settings the MJML wrapper uses (canvas width, background, base font, and the editor's
     *  working color PALETTE — may later move to the campaign brand kit). */
    export interface DocSettings
    {
        width?          : number;          // px, mj-body width (default ~600)
        backgroundColor? : string;
        fontFamily?     : string;
        palette?        : Array<string>;   // the email editor's color palette (email brand colors)
    }

    /** The editable SOURCE — the block tree + settings + optional head. Maps to MJML (`toMjml`) → HTML at
     *  publish/send (compiled through the real `mjml` engine). */
    export interface Doc { schema : number; settings : DocSettings; head? : Head; blocks : Array<Block>; }

    /** The template ENTITY (DynamoDB frontend + S3 bodies, versioned). `doc` is the JSON source; `mjml`/`html`
     *  are the compiled outputs (regenerated on save/publish). One PUBLISHED per (scope, notificationType). */
    export interface Entity
    {
        id                : string;
        accountId?        : string;              // set for ACCOUNT scope; omitted for SYSTEM
        scope             : Scope;
        campaignId?       : string;              // OPTIONAL campaign this ACCOUNT template belongs to (undef = account-wide)
        notificationType? : NotificationType;    // the case this template serves (undef = a free campaign template)
        name              : string;
        status            : Status;
        version           : number;              // bumps on each save (S3 keeps history)
        subject           : string;              // may carry merge tags
        from?             : Email.Address;        // overrides the account/system default sender when sending this template
        replyTo?          : Email.Address;         // overrides the request/default reply-to when sending this template
        doc               : Doc;                 // the editable block tree (JSON)
        mjml?             : string;              // compiled MJML (intermediate)
        html?             : string;              // compiled responsive HTML (send output)
        thumbnailAssetId? : string;              // a rendered preview thumbnail (media asset)
        versions?         : Array<VersionInfo>;  // the save history (email-2.7) — each body snapshotted to S3
        audit             : Audit;
    }

    /** Who/when created + last modified + published (mirrors the platform audit shape). */
    export interface Audit { createdBy? : string; createdAt : string; modifiedBy? : string; modifiedAt : string; publishedBy? : string; publishedAt? : string; }

    /** One entry in a template's version HISTORY (email-2.7) — appended on every save. Each version's full body
     *  ({@link VersionBody}) is snapshotted immutably to S3 so an earlier version can be previewed + restored. */
    export interface VersionInfo { version : number; savedAt : string; savedBy? : string; status : Status; }

    /** The immutable per-version body snapshotted to S3 — the editable `doc` + subject + compiled outputs at that
     *  version. Read to PREVIEW or RESTORE an earlier version (older snapshots may omit `subject`). */
    export interface VersionBody { version : number; savedAt? : string; subject? : string; from? : Email.Address; replyTo? : Email.Address; doc : Doc; mjml? : string; html? : string; }

    /** The create payload — the server assigns id / version / status / audit. */
    export type Create = Omit<Entity, "id" | "version" | "status" | "audit">;

    /** A blank starter document (one section + column + text) — seeds a new template. */
    export const DEFAULT_DOC : Doc =
    {
        schema: 1,
        settings: { width: 600, backgroundColor: "#f4f4f4", fontFamily: "Arial, sans-serif", palette: [] },
        blocks:
        [
            { id: "s1", type: BlockType.SECTION, children:
                [ { id: "c1", type: BlockType.COLUMN, children:
                    [ { id: "t1", type: BlockType.TEXT, props: { html: "<p>Your content…</p>" } } ] } ] },
        ],
    };

    /** A prebuilt SECTION the editor drops in whole (hero / body / CTA / footer, …). The `block` is a template
     *  subtree; the editor deep-clones it and mints fresh ids on insert. One-click starting points. (email-2.6) */
    export interface StockSection { key : string; label : string; block : Block; }

    // a SECTION wrapping a single COLUMN of the given content blocks
    function stockSection( id : string, content : Array<Block> ) : Block
    {
        return { id: `${ id }-s`, type: BlockType.SECTION, children: [ { id: `${ id }-c`, type: BlockType.COLUMN, children: content } ] };
    }

    /** The stock sections offered in the editor's "add section" palette. */
    export const STOCK_SECTIONS : Array<StockSection> =
    [
        { key: "hero", label: "Hero", block: stockSection( "hero", [
            { id: "hero-img", type: BlockType.IMAGE, props: { src: "", alt: "Hero image" } },
            { id: "hero-h",   type: BlockType.TEXT,  props: { html: "<h1 style=\"margin:0;font-size:28px;\">Welcome, {{name.first}}</h1>" } },
            { id: "hero-sub", type: BlockType.TEXT,  props: { html: "<p style=\"color:#555;\">A short subheading that sets the tone.</p>" } },
        ] ) },
        { key: "body", label: "Body text", block: stockSection( "body", [
            { id: "body-t", type: BlockType.TEXT, props: { html: "<p>Write your message here. Use the Insert field menu to personalize it with merge tags like {{name.first}}.</p>" } },
        ] ) },
        { key: "cta", label: "Call to action", block: stockSection( "cta", [
            { id: "cta-t",   type: BlockType.TEXT,   props: { html: "<p style=\"text-align:center;\">Ready to get started?</p>" } },
            { id: "cta-btn", type: BlockType.BUTTON, props: { text: "Get started", href: "https://", background: "#2563eb", color: "#ffffff" } },
        ] ) },
        { key: "footer", label: "Footer", block: stockSection( "footer", [
            { id: "footer-div", type: BlockType.DIVIDER },
            { id: "footer-t",   type: BlockType.TEXT, props: { html: "<p style=\"font-size:12px;color:#888;text-align:center;\">{{account.name}} · {{account.address}}<br/><a href=\"{{unsubscribe_url}}\">Unsubscribe</a></p>" } },
        ] ) },
    ];

    /** A merge field the editor's "insert field" palette offers — inserts `{{ token }}` at the cursor. */
    export interface MergeField { token : string; label : string; group : string; }

    /** The standard merge-field catalog (contact / account / campaign). An account's CUSTOM fields are appended
     *  at runtime from the contact service's field defs. (email-2.2) */
    export const MERGE_FIELDS : Array<MergeField> =
    [
        { group: "Contact", token: "name.first",       label: "First name" },
        { group: "Contact", token: "name.last",        label: "Last name" },
        { group: "Contact", token: "name.full",        label: "Full name" },
        { group: "Contact", token: "email",            label: "Email" },
        { group: "Contact", token: "address.street1",  label: "Street" },
        { group: "Contact", token: "address.city",     label: "City" },
        { group: "Contact", token: "address.state",    label: "State/Region" },
        { group: "Contact", token: "address.zip",      label: "Postal code" },
        { group: "Account", token: "account.name",     label: "Account name" },
        { group: "Account", token: "account.address",  label: "Account address" },
        { group: "Campaign", token: "campaign.name",   label: "Campaign name" },
        // ── System / platform (app-level) links + codes — the service injects these at send time for the matching
        //    notification case (reset / verification / MFA / invite); available to SYSTEM (and white-label) templates.
        { group: "System",  token: "unsubscribe_url",   label: "Unsubscribe link" },
        { group: "System",  token: "reset_url",         label: "Password-reset link" },
        { group: "System",  token: "verification_url",  label: "Email-verification link" },
        { group: "System",  token: "mfa_code",          label: "MFA code" },
        { group: "System",  token: "invite_url",        label: "Account-invite link" },
        { group: "System",  token: "login_url",         label: "Sign-in link" },
    ];

    /** The subset of {@link MERGE_FIELDS} scoped to platform/system mail (reset/verification/MFA/invite links +
     *  codes). Surfaced in the editor's insert-field palette when editing a SYSTEM (app-level) template. */
    export const SYSTEM_MERGE_FIELDS : Array<MergeField> = MERGE_FIELDS.filter( ( field : MergeField ) : boolean => field.group === "System" );
}

export default EmailTemplate;
// eof
