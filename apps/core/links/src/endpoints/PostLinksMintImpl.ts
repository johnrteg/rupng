//
import { PostLinksMint, Links } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import LinksService from "../services/LinksService";

//
// Mint a single tracked/untracked link (links-1.1/1.4/1.6).
//
export class PostLinksMintImpl extends PostLinksMint
{
    private service : LinksService;
    constructor( service : LinksService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const body : PostLinksMint.Body | null = this.body;
        if( !body?.accountId || !body.target || !body.targetType || !body.channel )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "accountId, target, targetType, and channel are required" } };

        const minted : Type.Result<Links.MintResult> = await this.service.mint( body );
        if( !minted.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: minted.error } };

        return { status: NetworkUtils.Status.OK, data: minted.data };
    }
}

export default PostLinksMintImpl;
// eof
