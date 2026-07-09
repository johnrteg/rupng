//
import { PatchContact, Contact } from "@repo/api";
import { NetworkUtils, ObjectUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import ContactService from "../services/ContactService";

//
// Update a contact — merge the supplied subset over the current record, bump the audit stamp, re-persist.
// Identity / accountId / status are not editable here (status changes via archive / forget).
//
export class PatchContactImpl extends PatchContact
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

        // read current, merge the patch, keep identity/status server-owned
        const got : Type.Result<Contact.Entity | undefined> = await this.service.dynamo.get<Contact.Entity>( "contacts", { accountId, contactId: id } );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "contact read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "contact not found" } };

        const current : Contact.Entity = ObjectUtils.withDefaults( got.data, Contact.DEFAULT );
        const now : Type.ISODateTime = new Date().toISOString();
        const merged : Contact.Entity =
        {
            ...current,
            ...this.body,
            id:        current.id,
            accountId: current.accountId,
            status:    current.status,
            audit:     { ...current.audit, modifiedAt: now, modifiedBy: auth.userId },
        };

        const wrote : Type.Result<void> = await this.service.dynamo.put( "contacts", { ...merged, contactId: id } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "contact write failed" } };

        // channels/consent may have changed → recompute the counts of the segments this contact is in (async)
        void this.service.enqueueSegmentRefresh( accountId, id );
        return { status: NetworkUtils.Status.OK, data: merged };
    }
}

export default PatchContactImpl;
