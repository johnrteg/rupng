//
// SvgTemplate — a reusable starting point for an SVG design. Templates are NOT SvgProject rows: they live in
// their own `svg-templates` DynamoDB table + S3 prefix, in two scopes (SYSTEM = platform-provided, read-only;
// ACCOUNT = an account's own "Save as template"). Creating a project from a template copies its S3 JSON to a
// new project. Owned by the media service; imported by the web editor (single source of truth).
//
export namespace SvgTemplate
{
    /** Who owns/sees a template — platform-global (read-only) or a single account's own. */
    export enum TemplateScope
    {
        SYSTEM  = "system",
        ACCOUNT = "account",
    }

    /** The template gallery categories (drives the create-dialog filter tabs). */
    export enum Category
    {
        FLYER         = "flyer",
        POSTCARD      = "postcard",
        MAILER        = "mailer",
        DOOR_HANGER   = "door_hanger",
        BUSINESS_CARD = "business_card",
        BROCHURE      = "brochure",
        LETTER        = "letter",
        SIGN          = "sign",
        SOCIAL        = "social",
        BLANK         = "blank",
    }

    /** The full template record (DynamoDB row) — metadata + the S3 keys of its doc + thumbnail. */
    export interface Entity
    {
        readonly id           : string;
        readonly scope        : TemplateScope;
        readonly accountId    : string | null;   // null for system templates
        readonly name         : string;
        readonly category     : Category;
        readonly canvasKey    : string;          // S3 key of the SvgDocument.Doc JSON
        readonly thumbnailKey : string;          // S3 key of the pre-rendered thumbnail PNG
        readonly tags         : Array<string>;
        readonly createdAt    : number;
        readonly updatedAt    : number;
    }

    /** The list-response projection — the Entity WITHOUT canvasKey (the doc body isn't needed to browse). */
    export interface Summary
    {
        readonly id           : string;
        readonly scope        : TemplateScope;
        readonly accountId    : string | null;
        readonly name         : string;
        readonly category     : Category;
        readonly thumbnailKey : string;
        readonly tags         : Array<string>;
        readonly createdAt    : number;
        readonly updatedAt    : number;
    }
}

export default SvgTemplate;
// eof
