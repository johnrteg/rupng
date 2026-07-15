//
import { Segment, GetSegmentMembers, Contact, Paging } from "@repo/api";
import { NetworkUtils, ObjectUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import ContactService from "../services/ContactService";

//
// List a segment's contacts — query the segment_members join on segmentKey, then hydrate each member to its
// full contact. (Dynamic-query segments resolve live members via search; this returns materialized rows.)
//
export class GetSegmentMembersImpl extends GetSegmentMembers
{
    private service : ContactService;
    constructor( service : ContactService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const segmentId : string = this.query?.id ?? "";
        if( !segmentId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "id required" } };

        // the segment must exist in this account
        const segment : Type.Result<Segment.Entity | undefined> = await this.service.dynamo.get<Segment.Entity>( "segments", { accountId, segmentId } );
        if( !segment.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "segment read failed" } };
        if( !segment.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "segment not found" } };

        // membership rows for this segment
        const members : Type.Result<Array<Segment.Member>> = await this.service.dynamo.query<Segment.Member>( "segment_members", {
            KeyConditionExpression:    "segmentKey = :sk",
            ExpressionAttributeValues: { ":sk": `${ accountId }#${ segmentId }` },
        } );
        if( !members.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "membership read failed" } };

        // hydrate each member to its contact (concurrently), dropping any that no longer exist
        const reads : Array<Promise<Type.Result<Contact.Entity | undefined>>> = members.data
            .map( ( member : Segment.Member ) : Promise<Type.Result<Contact.Entity | undefined>> => this.service.dynamo.get<Contact.Entity>( "contacts", { accountId, contactId: member.contactId } ) );
        const got : Array<Type.Result<Contact.Entity | undefined>> = await Promise.all( reads );
        const contacts : Array<Contact.Entity> = got
            .map( ( result : Type.Result<Contact.Entity | undefined> ) : Contact.Entity | undefined => result.ok ? result.data : undefined )
            .filter( ( entity : Contact.Entity | undefined ) : entity is Contact.Entity => entity !== undefined )
            .map( ( entity : Contact.Entity ) : Contact.Entity => ObjectUtils.withDefaults( entity, Contact.DEFAULT ) );

        const paged : Paging.Result<Contact.Entity> = Paging.paginate( contacts, this.query ?? { id: segmentId } );
        return { status: NetworkUtils.Status.OK, data: paged };
    }
}

export default GetSegmentMembersImpl;
