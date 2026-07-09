//
import { DeleteContactField, Contact } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import ContactService from "../services/ContactService";

//
// Delete a custom-field definition — HARD delete, but ONLY if no contact uses it. If any contact has a value
// for this field, return 409 (the caller should archive it instead, keeping the values). Usage is detected by
// scanning the account's contacts partition for the field uid (bounded per account; a field delete is rare).
//
export class DeleteContactFieldImpl extends DeleteContactField
{
    private service : ContactService;
    constructor( service : ContactService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const uid : string = this.query?.uid ?? "";
        if( !uid )           return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "uid required" } };

        const got : Type.Result<Contact.CustomFieldDef | undefined> = await this.service.dynamo.get<Contact.CustomFieldDef>( "field_defs", { accountId, fieldUid: uid } );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "field read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "field not found" } };

        // in use? scan the account's contacts for a value under this field uid (any non-empty value counts)
        const contacts : Type.Result<Array<Contact.Entity>> = await this.service.dynamo.query<Contact.Entity>( "contacts", {
            KeyConditionExpression:    "accountId = :a",
            ExpressionAttributeValues: { ":a": accountId },
        } );
        if( !contacts.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "usage check failed" } };
        const inUse : boolean = contacts.data.some( ( contact : Contact.Entity ) : boolean =>
        {
            const value : Contact.CustomFieldValue | undefined = contact.customFields?.[ uid ];
            return value !== undefined && String( value ).trim() !== "";
        } );
        if( inUse ) return { status: NetworkUtils.Status.CONFLICT, data: { message: "This field is in use by one or more contacts — archive it instead of deleting." } };

        // unused → SOFT-delete (status DELETED): recoverable by an app admin; a cron purges DELETED after a TTL
        const now : Type.ISODateTime = new Date().toISOString();
        const deleted : Contact.CustomFieldDef = { ...got.data, status: Contact.CustomFieldStatus.DELETED, audit: { ...got.data.audit, modifiedAt: now, modifiedBy: auth.userId } };
        const wrote : Type.Result<void> = await this.service.dynamo.put( "field_defs", { ...deleted, fieldUid: uid } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "field delete failed" } };

        return { status: NetworkUtils.Status.OK, data: { uid, deleted: true } };
    }
}

export default DeleteContactFieldImpl;
