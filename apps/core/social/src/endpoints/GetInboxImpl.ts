//
import { GetInbox, SocialInbound, Paging } from "@repo/api";
import { NetworkUtils, ObjectUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import SocialService from "../services/SocialService";

//
// List the acting account's inbound items. Query the accountId partition, hydrate from the model
// DEFAULT, filter in-memory (initial cut — matches GetConnections/GetPosts' pattern).
//
export class GetInboxImpl extends GetInbox
{
    private service : SocialService;
    constructor( service : SocialService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const found : Type.Result<Array<SocialInbound.Entity>> = await this.service.dynamo.query<SocialInbound.Entity>( "inbox", {
            KeyConditionExpression:    "accountId = :a",
            ExpressionAttributeValues: { ":a": accountId },
        } );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "inbox read failed" } };

        const query : GetInbox.Query = this.query ?? {};
        const items : Array<SocialInbound.Entity> = found.data
            .map( ( row : SocialInbound.Entity ) : SocialInbound.Entity => ObjectUtils.withDefaults( row, SocialInbound.DEFAULT ) )
            .filter( ( row : SocialInbound.Entity ) : boolean => query.type ? row.type === query.type : true )
            .filter( ( row : SocialInbound.Entity ) : boolean => query.platform ? row.platform === query.platform : true )
            .filter( ( row : SocialInbound.Entity ) : boolean => query.tag ? row.tags.includes( query.tag ) : true )
            .filter( ( row : SocialInbound.Entity ) : boolean => query.campaignId ? row.campaignId === query.campaignId : true )
            .filter( ( row : SocialInbound.Entity ) : boolean => query.status ? row.status === query.status : true )
            .filter( ( row : SocialInbound.Entity ) : boolean => query.from ? row.receivedAt >= query.from : true )
            .filter( ( row : SocialInbound.Entity ) : boolean => query.to ? row.receivedAt < query.to : true )
            .sort( ( first : SocialInbound.Entity, second : SocialInbound.Entity ) : number => second.receivedAt.localeCompare( first.receivedAt ) );

        const paged : Paging.Result<SocialInbound.Entity> = Paging.paginate( items, query );
        return { status: NetworkUtils.Status.OK, data: paged };
    }
}

export default GetInboxImpl;
