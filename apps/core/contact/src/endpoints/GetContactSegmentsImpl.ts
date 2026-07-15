//
import { Segment, GetContactSegments, Contact, Paging } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import ContactService from "../services/ContactService";

//
// List a contact's segments — query the segment_members `byContact` GSI on contactKey, then hydrate each to
// its full segment (dropping archived / vanished ones).
//
export class GetContactSegmentsImpl extends GetContactSegments
{
    private service : ContactService;
    constructor( service : ContactService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const contactId : string = this.query?.id ?? "";
        if( !contactId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "id required" } };

        // the contact must exist in this account
        const contact : Type.Result<Contact.Entity | undefined> = await this.service.dynamo.get<Contact.Entity>( "contacts", { accountId, contactId } );
        if( !contact.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "contact read failed" } };
        if( !contact.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "contact not found" } };

        // membership rows for this contact (via the inverted GSI)
        const members : Type.Result<Array<Segment.Member>> = await this.service.dynamo.query<Segment.Member>( "segment_members", {
            IndexName:                 "byContact",
            KeyConditionExpression:    "contactKey = :ck",
            ExpressionAttributeValues: { ":ck": `${ accountId }#${ contactId }` },
        } );
        if( !members.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "membership read failed" } };

        // hydrate each to its segment (concurrently), dropping any that no longer exist
        const reads : Array<Promise<Type.Result<Segment.Entity | undefined>>> = members.data
            .map( ( member : Segment.Member ) : Promise<Type.Result<Segment.Entity | undefined>> => this.service.dynamo.get<Segment.Entity>( "segments", { accountId, segmentId: member.segmentId } ) );
        const got : Array<Type.Result<Segment.Entity | undefined>> = await Promise.all( reads );
        const segments : Array<Segment.Entity> = got
            .map( ( result : Type.Result<Segment.Entity | undefined> ) : Segment.Entity | undefined => result.ok ? result.data : undefined )
            .filter( ( segment : Segment.Entity | undefined ) : segment is Segment.Entity => segment !== undefined );

        const paged : Paging.Result<Segment.Entity> = Paging.paginate( segments, this.query ?? { id: contactId } );
        return { status: NetworkUtils.Status.OK, data: paged };
    }
}

export default GetContactSegmentsImpl;
