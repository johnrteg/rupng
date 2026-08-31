//
import { NetworkUtils, ResultUtils, type Type } from "@repo/common";
import { RestfulService } from "@repo/endpoint";
import { Ports } from "@repo/services";
import { GetInternalContacts, Contact, Paging } from "@repo/api";

//
// ContactClient — the S2S client to contact's internal listing API. Base URL is `CONTACT_INTERNAL_URL` (the
// internal ALB DNS in deployed envs, wired by the CloudManifest `uses` entry), falling back to contact's
// local-dev port for `tsx watch`/LocalStack — same pattern as voice's `MediaClient`
// (apps/core/voice/src/clients/MediaClient.ts). Paginates internally — a generator gets the FULL account
// list in one call rather than juggling paging tokens itself.
//
export class ContactClient
{
    private readonly client : RestfulService;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
        this.client = new RestfulService(
            process.env.CONTACT_INTERNAL_URL ?? NetworkUtils.url( NetworkUtils.Protocol.HTTP, "localhost", Ports.CONTACT.MAIN, null, null ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** All of an account's contacts (optionally filtered by status), walking every page. */
    public async listContacts( accountId : Type.ID, status? : Contact.ContactStatus ) : Promise<Type.Result<Array<Contact.Entity>>>
    {
        const all : Array<Contact.Entity> = [];
        let start : string | undefined = undefined;

        // walk pages until the server stops handing back a `next` token
        for( ;; )
        {
            const reply : RestfulService.Reply<GetInternalContacts.Response> = await this.client.fetch(
                new GetInternalContacts( { accountId, status, start, count: Paging.MAX_COUNT } ) );
            if( !reply.ok ) return ResultUtils.err( `contact internal list failed (${ reply.status })` );

            const page : GetInternalContacts.Response = reply.data as GetInternalContacts.Response;
            all.push( ...page.records );
            if( page.page.next === undefined ) break;
            start = page.page.next;
        }
        return ResultUtils.ok( all );
    }
}

export default ContactClient;
// eof
