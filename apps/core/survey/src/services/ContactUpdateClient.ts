//
import { NetworkUtils, ResultUtils, type Type } from "@repo/common";
import { RestfulService } from "@repo/endpoint";
import { Ports } from "@repo/cloud-manifest";
import { PostInternalContactUpdate, Contact } from "@repo/api";

//
// ContactUpdateClient — the S2S client to contact's internal write endpoint (same pattern as
// apps/core/texting/src/clients/ContactClient.ts). Lands a survey score/tag onto a contact (survey-4.2)
// without a cross-service DB write — contact owns its own table; survey only ever calls its API.
//
export class ContactUpdateClient
{
    private readonly client : RestfulService;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
        this.client = new RestfulService(
            process.env.CONTACT_INTERNAL_URL ?? NetworkUtils.url( NetworkUtils.Protocol.HTTP, "localhost", Ports.CONTACT.MAIN, null, null ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Land tag adds/removes + custom-field values (e.g. a computed NPS/CSAT/CES score) onto a contact. */
    public async update( accountId : Type.ID, contactId : Type.ID, patch : Omit<PostInternalContactUpdate.Body, "accountId" | "contactId"> ) : Promise<Type.Result<Contact.Entity>>
    {
        const reply : RestfulService.Reply<PostInternalContactUpdate.Response> = await this.client.fetch(
            new PostInternalContactUpdate( { accountId, contactId, ...patch } ) );
        if( !reply.ok ) return ResultUtils.err( `contact internal update failed (${ reply.status })` );
        return ResultUtils.ok( reply.data as Contact.Entity );
    }
}

export default ContactUpdateClient;
// eof
