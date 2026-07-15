//
import { Segment, GetSegments, Paging } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import ContactService from "../services/ContactService";

//
// List the acting account's segments (the primary targeting tool). Hides archived segments, and campaign-built
// `hidden` segments unless the caller asks for them (`includeHidden`).
//
export class GetSegmentsImpl extends GetSegments
{
    private service : ContactService;
    constructor( service : ContactService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const found : Type.Result<Array<Segment.Entity>> = await this.service.dynamo.query<Segment.Entity>( "segments", {
            KeyConditionExpression:    "accountId = :a",
            ExpressionAttributeValues: { ":a": accountId },
        } );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "segments read failed" } };

        const query : GetSegments.Query = this.query ?? {};
        // hide archived always; hide campaign-built/hidden segments unless the caller opts in
        const segments : Array<Segment.Entity> = found.data
            .filter( ( row : Segment.Entity ) : boolean => row.status !== Segment.Status.ARCHIVED )
            .filter( ( row : Segment.Entity ) : boolean => query.includeHidden ? true : row.hidden !== true );
        const paged : Paging.Result<Segment.Entity> = Paging.paginate( segments, query );
        return { status: NetworkUtils.Status.OK, data: paged };
    }
}

export default GetSegmentsImpl;
