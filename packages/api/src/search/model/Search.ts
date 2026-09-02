//
// Search domain model — the wire shapes for the global content-search plane (see apps/core/search/SPECS.md).
//
// Search owns no source data: `Type` (below) is which entity KIND is indexed, `IndexDoc` is the flattened
// projection an owning service stamps + publishes, and `Query`/`Result` are the query-path request/response.
// `IndexDoc.accountId` + `minAccess` are the NON-NEGOTIABLE filter keys enforced server-side on every query
// (search-3.1/3.2) — the client can request `filters`, but can never widen the account/role scope.
//
import type { Type as CommonType } from "@repo/common";
import { Access } from "@repo/endpoint";

export namespace Search
{
    /** Which searchable entity kinds v1 indexes (search-4.2) — more are added later, each owning service
     *  emits its own doc. Closed set, never a bare string. */
    export enum DocType
    {
        CAMPAIGN = "campaign",
        CONTACT  = "contact",
        SEGMENT  = "segment",
        EMAIL    = "email",
    }

    /** A searchable projection of a source entity — the OWNING service produces + stamps this, search only
     *  stores/queries it (search-1.2). `minAccess` is the floor role that may SEE this doc, independent of
     *  the event's own consume-floor in `Events.ts`. */
    export interface IndexDoc
    {
        id:         CommonType.UUID;    // the source entity's id (also the OpenSearch doc _id)
        type:       DocType;
        accountId:  CommonType.UUID;
        minAccess:  Access.Role;
        title:      string;             // primary display line (name / subject / …)
        text:       string;             // the searchable body (notes, description, merged fields)
        fields?:    Record<string, CommonType.JsonPrimitive>;   // extra faceted/filterable fields (per-type)
        updatedAt:  CommonType.ISODateTime;
    }

    /** One ranked hit — the doc plus its relevance score + optional highlighted snippet. */
    export interface Hit
    {
        doc:        IndexDoc;
        score:      number;
        highlight?: string;
    }

    /** Query filters, all optional (search-2.1). `exact` opts into a verbatim, case-insensitive phrase match
     *  against the `keyword` sub-field instead of the default phonetic/fuzzy match (search-2.3.1). */
    export interface Filters
    {
        type?:  DocType;
        from?:  CommonType.ISODateTime;
        to?:    CommonType.ISODateTime;
        exact?: boolean;
    }

    /** A page of ranked results (search-2.1). */
    export interface Result
    {
        hits:       Array<Hit>;
        total:      number;
        page:       number;
        pageSize:   number;
    }
}

export default Search;
// eof
