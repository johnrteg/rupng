//
import { DeleteContact, Contact } from "@repo/api";
import { NetworkUtils, ObjectUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Events, Payloads } from "@repo/system";
import ContactService from "../services/ContactService";

//
// Archive a contact (soft — status → ARCHIVED, restorable; never hard-deleted). GDPR forget is a separate,
// heavier flow (a fan-out that redacts PII across content services), not this endpoint.
//
export class DeleteContactImpl extends DeleteContact
{
    private service : ContactService;
    constructor( service : ContactService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const id : string = this.query?.id ?? "";
        if( !id )            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "id required" } };

        // read current, flip status to ARCHIVED, re-persist
        const got : Type.Result<Contact.Entity | undefined> = await this.service.dynamo.get<Contact.Entity>( "contacts", { accountId, contactId: id } );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "contact read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "contact not found" } };

        const current : Contact.Entity = ObjectUtils.withDefaults( got.data, Contact.DEFAULT );
        const now : Type.ISODateTime = new Date().toISOString();
        const archived : Contact.Entity = { ...current, status: Contact.ContactStatus.ARCHIVED, audit: { ...current.audit, modifiedAt: now, modifiedBy: auth.userId } };

        const wrote : Type.Result<void> = await this.service.dynamo.put( "contacts", { ...archived, contactId: id } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "contact archive failed" } };

        // archived contact drops out of reachable counts → recompute its segments (async)
        void this.service.enqueueSegmentRefresh( accountId, id );

        // best-effort CRUD event — never blocks the response
        const payload : Payloads.Contact = { id: archived.id, accountId: archived.accountId, firstName: archived.firstName, lastName: archived.lastName, status: archived.status };
        void this.service.emit( Events.Verb.DELETED, archived.id, accountId, payload, auth.userId );

        return { status: NetworkUtils.Status.OK, data: { id, archived: true } };
    }
}

export default DeleteContactImpl;
