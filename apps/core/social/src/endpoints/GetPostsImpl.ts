//
import { GetPosts, SocialPost, Paging } from "@repo/api";
import { NetworkUtils, ObjectUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import SocialService from "../services/SocialService";

//
// List the acting account's posts. Query the accountId partition, hydrate from the model DEFAULT,
// optionally filter by status.
//
export class GetPostsImpl extends GetPosts
{
    private service : SocialService;
    constructor( service : SocialService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const found : Type.Result<Array<SocialPost.Entity>> = await this.service.dynamo.query<SocialPost.Entity>( "posts", {
            KeyConditionExpression:    "accountId = :a",
            ExpressionAttributeValues: { ":a": accountId },
        } );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "posts read failed" } };

        const query : GetPosts.Query = this.query ?? {};
        const posts : Array<SocialPost.Entity> = found.data
            .map( ( row : SocialPost.Entity ) : SocialPost.Entity => ObjectUtils.withDefaults( row, SocialPost.DEFAULT ) )
            .filter( ( row : SocialPost.Entity ) : boolean => query.status ? row.status === query.status : true )
            .sort( ( first : SocialPost.Entity, second : SocialPost.Entity ) : number => String( second.createdAt ?? "" ).localeCompare( String( first.createdAt ?? "" ) ) );

        const paged : Paging.Result<SocialPost.Entity> = Paging.paginate( posts, query );
        return { status: NetworkUtils.Status.OK, data: paged };
    }
}

export default GetPostsImpl;
