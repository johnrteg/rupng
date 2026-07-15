//
import { randomUUID } from "node:crypto";

import { PostContactField, Contact } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import ContactService from "../services/ContactService";

//
// Create a custom-field definition. Server assigns uid / accountId / status (ACTIVE) / audit; the stored row
// mirrors uid into the `fieldUid` sort-key. Type is captured here and immutable thereafter.
//
export class PostContactFieldImpl extends PostContactField
{
    private service : ContactService;
    constructor( service : ContactService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const label : string = this.body?.label ?? "";
        if( !label || !this.body?.type ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "label and type required" } };

        const now : Type.ISODateTime = new Date().toISOString();
        const uid : Type.UUID = randomUUID();
        const def : Contact.CustomFieldDef =
        {
            uid, accountId, label,
            type:     this.body.type,
            choices:  this.body.choices,
            currency: this.body.currency,
            required: this.body.required,
            indexed:  this.body.indexed,
            group:    this.body.group,
            order:    this.body.order,
            status:   Contact.CustomFieldStatus.ACTIVE,
            audit:    { createdAt: now, createdBy: auth.userId, modifiedAt: now, modifiedBy: auth.userId },
        };

        const wrote : Type.Result<void> = await this.service.dynamo.put( "field_defs", { ...def, fieldUid: uid } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "field write failed" } };

        return { status: NetworkUtils.Status.OK, data: def };
    }
}

export default PostContactFieldImpl;
