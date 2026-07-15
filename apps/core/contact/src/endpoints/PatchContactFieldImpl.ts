//
import { PatchContactField, Contact } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import ContactService from "../services/ContactService";

//
// Edit a custom-field definition — merge the editable subset (label/choices/currency/required/indexed/group/
// order/status) over the current row; TYPE and uid stay immutable. Bumps the audit stamp.
//
export class PatchContactFieldImpl extends PatchContactField
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

        const now : Type.ISODateTime = new Date().toISOString();
        const merged : Contact.CustomFieldDef =
        {
            ...got.data,
            label:    this.body?.label    !== undefined ? this.body.label    : got.data.label,
            choices:  this.body?.choices  !== undefined ? this.body.choices  : got.data.choices,
            currency: this.body?.currency !== undefined ? this.body.currency : got.data.currency,
            required: this.body?.required !== undefined ? this.body.required : got.data.required,
            indexed:  this.body?.indexed  !== undefined ? this.body.indexed  : got.data.indexed,
            group:    this.body?.group    !== undefined ? this.body.group    : got.data.group,
            order:    this.body?.order    !== undefined ? this.body.order    : got.data.order,
            status:   this.body?.status   !== undefined ? this.body.status   : got.data.status,
            uid:      got.data.uid,
            type:     got.data.type,       // immutable
            accountId: got.data.accountId,
            audit:    { ...got.data.audit, modifiedAt: now, modifiedBy: auth.userId },
        };

        const wrote : Type.Result<void> = await this.service.dynamo.put( "field_defs", { ...merged, fieldUid: uid } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "field write failed" } };

        return { status: NetworkUtils.Status.OK, data: merged };
    }
}

export default PatchContactFieldImpl;
