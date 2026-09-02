//
import { PostContactForget, Contact } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import ContactService from "../services/ContactService";

//
// Trigger a GDPR forget (contact-10.3) — enqueues; ContactService.processForget does the redaction
// + fan-out off the request path.
//
export class PostContactForgetImpl extends PostContactForget
{
    private service : ContactService;
    constructor( service : ContactService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const contactId : string = this.body?.contactId ?? "";
        if( !contactId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "contactId required" } };

        const got : Type.Result<Contact.Entity | undefined> = await this.service.dynamo.get( "contacts", { accountId, contactId } );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "contact read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "contact not found" } };

        const queued : Type.Result<void> = await this.service.enqueueForget( accountId, contactId, auth.userId, this.body?.reason );
        if( !queued.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not queue the forget" } };

        return { status: NetworkUtils.Status.OK, data: { queued: true } };
    }
}

export default PostContactForgetImpl;
// eof
