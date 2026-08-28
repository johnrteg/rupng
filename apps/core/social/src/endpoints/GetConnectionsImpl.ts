//
import { GetConnections, SocialAccount, Paging } from "@repo/api";
import { NetworkUtils, ObjectUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import SocialService from "../services/SocialService";

//
// List the acting account's connected destinations. Query the accountId partition, hydrate from the
// model DEFAULT, optionally filter by platform.
//
export class GetConnectionsImpl extends GetConnections
{
    private service : SocialService;
    constructor( service : SocialService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const found : Type.Result<Array<SocialAccount.Entity>> = await this.service.dynamo.query<SocialAccount.Entity>( "connections", {
            KeyConditionExpression:    "accountId = :a",
            ExpressionAttributeValues: { ":a": accountId },
        } );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "connections read failed" } };

        const query : GetConnections.Query = this.query ?? {};
        const connections : Array<SocialAccount.Entity> = found.data
            .map( ( row : SocialAccount.Entity ) : SocialAccount.Entity => ObjectUtils.withDefaults( row, SocialAccount.DEFAULT ) )
            .filter( ( row : SocialAccount.Entity ) : boolean => query.platform ? row.platform === query.platform : true )
            .sort( ( first : SocialAccount.Entity, second : SocialAccount.Entity ) : number => String( second.createdAt ?? "" ).localeCompare( String( first.createdAt ?? "" ) ) );

        const paged : Paging.Result<SocialAccount.Entity> = Paging.paginate( connections, query );
        return { status: NetworkUtils.Status.OK, data: paged };
    }
}

export default GetConnectionsImpl;
