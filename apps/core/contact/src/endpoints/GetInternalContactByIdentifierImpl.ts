//
import { GetInternalContactByIdentifier, Contact } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import ContactService from "../services/ContactService";

//
// S2S: resolve a normalized phone/email value to its contactId within one account (contact-1.7 /
// analytics-1.7 identity resolution — see GetInternalContactByIdentifier.ts). Account-scoped Query
// + in-memory filter (same shape as GetInternalContactsImpl); no dedicated identifier GSI yet.
//
export class GetInternalContactByIdentifierImpl extends GetInternalContactByIdentifier
{
    private service : ContactService;
    constructor( service : ContactService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const accountId : string = this.query?.accountId ?? "";
        const value     : string = this.query?.value ?? "";
        if( !accountId || !value ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "accountId and value are required" } };

        // read the account's contact partition and match the normalized identifier against emails/phones —
        // the caller (channel service) already normalized `value` (lowercased email / E.164 phone)
        const found : Type.Result<Array<Contact.Entity>> = await this.service.dynamo.query<Contact.Entity>( "contacts", {
            KeyConditionExpression:    "accountId = :a",
            ExpressionAttributeValues: { ":a": accountId },
        } );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "contacts read failed" } };

        const match : Contact.Entity | undefined = found.data
            .filter( ( row : Contact.Entity ) : boolean => row.status !== Contact.ContactStatus.FORGOTTEN )
            .find( ( row : Contact.Entity ) : boolean =>
                row.emails.some( ( entry : Contact.EmailEntry ) : boolean => entry.value.toLowerCase() === value.toLowerCase() ) ||
                row.phones.some( ( entry : Contact.PhoneEntry ) : boolean => entry.value === value ) );

        if( !match ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "no contact matches that identifier" } };
        return { status: NetworkUtils.Status.OK, data: { contactId: match.id } };
    }
}

export default GetInternalContactByIdentifierImpl;
// eof
