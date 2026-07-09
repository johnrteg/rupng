//
import { GetContacts, Contact, Paging } from "@repo/api";
import { NetworkUtils, ObjectUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import ContactService from "../services/ContactService";

//
// List the acting account's contacts. First cut: query all rows on the accountId partition, hydrate from
// the model DEFAULT, hide FORGOTTEN tombstones unless a status filter asks otherwise, newest-ish first.
//
export class GetContactsImpl extends GetContacts
{
    private service : ContactService;
    constructor( service : ContactService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        // read every contact on this account's partition
        const found : Type.Result<Array<Contact.Entity>> = await this.service.dynamo.query<Contact.Entity>( "contacts", {
            KeyConditionExpression:    "accountId = :a",
            ExpressionAttributeValues: { ":a": accountId },
        } );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "contacts read failed" } };

        // hydrate + filter: an explicit status filter wins; otherwise hide FORGOTTEN tombstones
        const query : GetContacts.Query = this.query ?? {};
        const contacts : Array<Contact.Entity> = found.data
            .map( ( row : Contact.Entity ) : Contact.Entity => ObjectUtils.withDefaults( row, Contact.DEFAULT ) )
            .filter( ( row : Contact.Entity ) : boolean => query.status ? row.status === query.status : row.status !== Contact.ContactStatus.FORGOTTEN );

        // page the filtered set (in-memory) into the standard { data, page } envelope
        const paged : Paging.Result<Contact.Entity> = Paging.paginate( contacts, query );
        return { status: NetworkUtils.Status.OK, data: paged };
    }
}

export default GetContactsImpl;
