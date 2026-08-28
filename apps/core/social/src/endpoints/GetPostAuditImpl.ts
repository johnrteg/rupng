//
import { GetPostAudit, SocialPost } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import SocialService from "../services/SocialService";

//
// A post's append-only audit trail, oldest first.
//
export class GetPostAuditImpl extends GetPostAudit
{
    private service : SocialService;
    constructor( service : SocialService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const id : string = this.query?.id ?? "";
        if( !id )           return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "id required" } };

        const found : Type.Result<Array<SocialPost.ReviewAudit>> = await this.service.dynamo.query<SocialPost.ReviewAudit>( "post_audit", {
            KeyConditionExpression:    "postId = :p",
            ExpressionAttributeValues: { ":p": id },
            ScanIndexForward:          true,
        } );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "audit read failed" } };

        return { status: NetworkUtils.Status.OK, data: { audit: found.data } };
    }
}

export default GetPostAuditImpl;
