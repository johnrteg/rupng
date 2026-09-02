//
import { NetworkUtils, ResultUtils, type Type } from "@repo/common";
import { RestfulService } from "@repo/endpoint";
import { Ports } from "@repo/services";
import { GetInternalContacts, Contact } from "@repo/api";

//
// ContactClient — the S2S client to contact's internal listing API (same pattern as
// apps/core/report/src/clients/ContactClient.ts). Texting only needs ONE contact's default phone at
// send time; there's no single-id S2S lookup yet (gap — see SPECS.md), so this walks the account's
// contact list and matches by id. Fine at MVP volume; revisit with a dedicated by-id S2S endpoint
// (mirroring contact's new by-identifier one) if a large account's list makes this too slow.
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
    /** The contact's default (or first) phone number, or undefined if unresolved / phoneless. */
    public async resolvePhone( accountId : Type.ID, contactId : Type.ID ) : Promise<Type.Result<string | undefined>>
    {
        const reply : RestfulService.Reply<GetInternalContacts.Response> = await this.client.fetch(
            new GetInternalContacts( { accountId, count: 1000 } ) );
        if( !reply.ok ) return ResultUtils.err( `contact internal list failed (${ reply.status })` );

        const page : GetInternalContacts.Response = reply.data as GetInternalContacts.Response;
        const contact : Contact.Entity | undefined = page.records.find( ( row : Contact.Entity ) : boolean => row.id === contactId );
        if( !contact ) return ResultUtils.ok( undefined );

        const phone : Contact.PhoneEntry | undefined = contact.phones.find( ( entry : Contact.PhoneEntry ) : boolean => entry.isDefault ) ?? contact.phones[ 0 ];
        return ResultUtils.ok( phone?.value );
    }
}

export default ContactClient;
// eof
