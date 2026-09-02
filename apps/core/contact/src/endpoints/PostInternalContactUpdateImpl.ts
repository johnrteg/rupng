//
import { PostInternalContactUpdate, Contact } from "@repo/api";
import { NetworkUtils, ObjectUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Events, Payloads } from "@repo/system";
import ContactService from "../services/ContactService";

//
// S2S: land tag adds/removes + custom-field values onto a contact — no user session (INTERNAL audience),
// the caller passes `accountId`/`contactId` explicitly. Mirrors PatchContactImpl's read/merge/write +
// segment-refresh + best-effort emit, minus the `auth.userId` requirement. First consumer: survey's
// SurveyResponseJob landing an NPS/CSAT/CES score + follow-up tags on scoring (survey-4.2).
//
export class PostInternalContactUpdateImpl extends PostInternalContactUpdate
{
    private service : ContactService;
    constructor( service : ContactService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const accountId : string = this.body?.accountId ?? "";
        const contactId : string = this.body?.contactId ?? "";
        if( !accountId || !contactId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "accountId and contactId are required" } };

        // read current, merge tag adds/removes + custom-field values, keep identity/status server-owned
        const got : Type.Result<Contact.Entity | undefined> = await this.service.dynamo.get<Contact.Entity>( "contacts", { accountId, contactId } );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "contact read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "contact not found" } };

        const current : Contact.Entity = ObjectUtils.withDefaults( got.data, Contact.DEFAULT );
        const now : Type.ISODateTime = new Date().toISOString();

        // tags: drop any whose value is in removeTagValues, then append addTags (dedup by namespace+value)
        const removeValues : Array<string> = this.body?.removeTagValues ?? [];
        const kept : Array<Contact.Tag> = ( current.tags ?? [] ).filter( ( tag : Contact.Tag ) : boolean => !removeValues.includes( tag.value ) );
        const additions : Array<Contact.Tag> = ( this.body?.addTags ?? [] ).filter( ( tag : Contact.Tag ) : boolean =>
            !kept.some( ( existing : Contact.Tag ) : boolean => existing.namespace === tag.namespace && existing.value === tag.value ) );
        const mergedTags : Array<Contact.Tag> = [ ...kept, ...additions ];

        const merged : Contact.Entity =
        {
            ...current,
            tags:         mergedTags,
            customFields: { ...current.customFields, ...( this.body?.setCustomFields ?? {} ) },
            id:           current.id,
            accountId:    current.accountId,
            status:       current.status,
            audit:        { ...current.audit, modifiedAt: now, modifiedBy: "system:survey" },
        };

        const wrote : Type.Result<void> = await this.service.dynamo.put( "contacts", { ...merged, contactId } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "contact write failed" } };

        // tags/custom fields may feed segment membership → recompute affected segment counts (async)
        void this.service.enqueueSegmentRefresh( accountId, contactId );

        // best-effort CRUD event — never blocks the response
        const payload : Payloads.Contact = { id: merged.id, accountId: merged.accountId, firstName: merged.firstName, lastName: merged.lastName, status: merged.status };
        void this.service.emit( Events.Verb.UPDATED, merged.id, accountId, payload );

        return { status: NetworkUtils.Status.OK, data: merged };
    }
}

export default PostInternalContactUpdateImpl;
// eof
