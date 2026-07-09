//
import { GetContactFields, Contact, Paging } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import ContactService from "../services/ContactService";

//
// List the account's custom-field definitions — sorted by (group, order) for the profile editor. Default hides
// archived fields; a `status` filter can request them.
//
export class GetContactFieldsImpl extends GetContactFields
{
    private service : ContactService;
    constructor( service : ContactService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const found : Type.Result<Array<Contact.CustomFieldDef>> = await this.service.dynamo.query<Contact.CustomFieldDef>( "field_defs", {
            KeyConditionExpression:    "accountId = :a",
            ExpressionAttributeValues: { ":a": accountId },
        } );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "fields read failed" } };

        const query : GetContactFields.Query = this.query ?? {};
        const fields : Array<Contact.CustomFieldDef> = found.data
            .filter( ( def : Contact.CustomFieldDef ) : boolean => query.status ? def.status === query.status : ( def.status !== Contact.CustomFieldStatus.ARCHIVED && def.status !== Contact.CustomFieldStatus.DELETED ) )
            .sort( ( first : Contact.CustomFieldDef, second : Contact.CustomFieldDef ) : number =>
                ( first.group ?? "" ).localeCompare( second.group ?? "" ) || ( first.order ?? 0 ) - ( second.order ?? 0 ) || first.label.localeCompare( second.label ) );

        const paged : Paging.Result<Contact.CustomFieldDef> = Paging.paginate( fields, query );
        return { status: NetworkUtils.Status.OK, data: paged };
    }
}

export default GetContactFieldsImpl;
