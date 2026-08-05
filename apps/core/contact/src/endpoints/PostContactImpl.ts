//
import { randomUUID } from "node:crypto";

import { PostContact, Contact } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import ContactService from "../services/ContactService";

//
// Create a contact under the acting account. Server assigns id / accountId / status (ACTIVE) / audit; the
// stored row carries a `contactId` sort-key mirroring `id`. First cut — no dedup/consent normalization yet.
//
export class PostContactImpl extends PostContact
{
    private service : ContactService;
    constructor( service : ContactService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        // allocate the per-account sequential reference number (immutable once set) BEFORE the write — a failed
        // allocation aborts the create so we never persist an unnumbered contact
        const ref : Type.Result<number> = await this.service.nextRef( accountId, ContactService.SequenceKind.CONTACT );
        if( !ref.ok )        return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "contact ref allocation failed" } };

        // assemble the record — server owns identity, status, and the audit stamp
        const now : Type.ISODateTime = new Date().toISOString();
        const id : Type.UUID = randomUUID();
        const entity : Contact.Entity =
        {
            ...this.body,
            id,
            accountId,
            ref:    ref.data,
            emails: this.body?.emails ?? [],
            phones: this.body?.phones ?? [],
            status: Contact.ContactStatus.ACTIVE,
            audit:  { createdAt: now, createdBy: auth.userId, modifiedAt: now, modifiedBy: auth.userId },
        };

        // persist — the table SK is `contactId`, so mirror `id` into it
        const wrote : Type.Result<void> = await this.service.dynamo.put( "contacts", { ...entity, contactId: id } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "contact write failed" } };

        return { status: NetworkUtils.Status.OK, data: entity };
    }
}

export default PostContactImpl;
