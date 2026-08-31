//
import type { Type } from "@repo/common";
import { Contact } from "@repo/api";

import { ContactClient } from "../clients/ContactClient";
import { ReportGenerator } from "./ReportGenerator";

//
// ContactsReportGenerator — the "contacts" catalog entry's generator (report-9.1). Pulls the account's full
// contact list from `contact`'s internal S2S API, applies the optional `status` filter, and flattens each
// contact's default email/phone into a row. Window filtering is NOT applied here — contact has no
// created-at-in-window S2S filter today (`GetInternalContacts` doesn't accept a date range), so a
// `contacts` report's `window` param resolves the range for audit/reproducibility (`Submission.window`)
// but doesn't currently narrow the pulled rows; a future contact-side date filter would plug in here.
//
export class ContactsReportGenerator implements ReportGenerator
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    public async generate( ctx : ReportGenerator.GenerateContext ) : Promise<Type.Result<ReportGenerator.GenerateResult>>
    {
        const params : ContactsReportGenerator.Params = ctx.params as ContactsReportGenerator.Params;
        const client : ContactClient = new ContactClient();
        const found : Type.Result<Array<Contact.Entity>> = await client.listContacts( ctx.accountId, {
            status: params.status, modifiedStart: params.modifiedStart, modifiedEnd: params.modifiedEnd,
            segmentId: params.segmentId, tags: params.tags,
        } );
        if( !found.ok ) return { ok: false, error: found.error };

        const columns : Array<string> = [ "id", "ref", "firstName", "lastName", "email", "phone", "status", "createdAt" ];
        const rows : Array<Record<string, unknown>> = found.data.map( ( contact : Contact.Entity ) : Record<string, unknown> =>
        {
            const defaultEmail : Contact.EmailEntry | undefined = contact.emails.find( ( entry : Contact.EmailEntry ) : boolean => entry.isDefault ) ?? contact.emails[ 0 ];
            const defaultPhone : Contact.PhoneEntry | undefined = contact.phones.find( ( entry : Contact.PhoneEntry ) : boolean => entry.isDefault ) ?? contact.phones[ 0 ];
            return {
                id: contact.id, ref: contact.ref, firstName: contact.firstName ?? "", lastName: contact.lastName ?? "",
                email: defaultEmail?.value ?? "", phone: defaultPhone?.value ?? "",
                status: contact.status, createdAt: contact.audit.createdAt,
            };
        } );

        return { ok: true, data: { rows, columns } };
    }
}

export namespace ContactsReportGenerator
{
    /** The narrowed shape of this report's `paramsSchema`-validated `params` (`ContactsReport`'s catalog
     *  entry, `@repo/api`) — all filters beyond the shared base `window` are optional. */
    export interface Params
    {
        status?        : Contact.ContactStatus;
        modifiedStart? : Type.ISODateTime;
        modifiedEnd?   : Type.ISODateTime;
        segmentId?     : string;
        tags?          : Array<string>;
    }
}

export default ContactsReportGenerator;
// eof
