//
import { GetInternalContacts, Contact, Paging } from "@repo/api";
import { NetworkUtils, ObjectUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import ContactService from "../services/ContactService";

//
// S2S: list an EXPLICIT account's contacts. Same read/hydrate/filter/page shape as GetContactsImpl, but the
// account comes from the query param (no user session on an S2S call) and there is no RBAC check to make.
//
export class GetInternalContactsImpl extends GetInternalContacts
{
    private service : ContactService;
    constructor( service : ContactService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const query : GetInternalContacts.Query | undefined = this.query;
        const accountId : string | undefined = query?.accountId;
        if( !accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "accountId is required" } };

        // read every contact on the requested account's partition
        const found : Type.Result<Array<Contact.Entity>> = await this.service.dynamo.query<Contact.Entity>( "contacts", {
            KeyConditionExpression:    "accountId = :a",
            ExpressionAttributeValues: { ":a": accountId },
        } );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "contacts read failed" } };

        // hydrate + filter: an explicit status filter wins; otherwise hide FORGOTTEN tombstones
        const contacts : Array<Contact.Entity> = found.data
            .map( ( row : Contact.Entity ) : Contact.Entity => ObjectUtils.withDefaults( row, Contact.DEFAULT ) )
            .filter( ( row : Contact.Entity ) : boolean => query?.status ? row.status === query.status : row.status !== Contact.ContactStatus.FORGOTTEN );

        // page the filtered set (in-memory) into the standard { records, page } envelope
        const paged : Paging.Result<Contact.Entity> = Paging.paginate( contacts, query ?? { accountId } );
        return { status: NetworkUtils.Status.OK, data: paged };
    }
}

export default GetInternalContactsImpl;
// eof
