//
import { NetworkUtils, ResultUtils, type Type } from "@repo/common";
import { RestfulService } from "@repo/endpoint";
import { Ports } from "@repo/cloud-manifest";
import { GetInternalContacts, Contact } from "@repo/api";

//
// ContactSegmentClient — resolves a distribution's audience (survey-3.2) via contact's S2S list endpoint,
// filtered by segmentId (same pattern as apps/core/texting/src/clients/ContactClient.ts) — no cross-service
// DB read. Contact's segment-membership filter already does the work; this just walks the pages.
//
export class ContactSegmentClient
{
    private readonly client : RestfulService;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
        this.client = new RestfulService(
            process.env.CONTACT_INTERNAL_URL ?? NetworkUtils.url( NetworkUtils.Protocol.HTTP, "localhost", Ports.CONTACT.MAIN, null, null ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Every active contact in a segment (paged internally; returns the flattened list). */
    public async membersOf( accountId : Type.ID, segmentId : Type.ID ) : Promise<Type.Result<Array<Contact.Entity>>>
    {
        const reply : RestfulService.Reply<GetInternalContacts.Response> = await this.client.fetch(
            new GetInternalContacts( { accountId, segmentId, count: 1000 } ) );
        if( !reply.ok ) return ResultUtils.err( `contact internal list failed (${ reply.status })` );

        const page : GetInternalContacts.Response = reply.data as GetInternalContacts.Response;
        return ResultUtils.ok( page.records );
    }
}

export default ContactSegmentClient;
// eof
