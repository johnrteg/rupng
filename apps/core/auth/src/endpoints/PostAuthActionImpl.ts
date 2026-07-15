//
import { PostAuthAction, AuthAction } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import AuthService from "../services/AuthService";

//
// Mint a pending action (INTERNAL / S2S) — a producer creates a TTL landing token and gets back its id + landing
// PATH + expiry. The caller assembles the full URL (base resolved at send) and emails it (via the email queue).
//
export class PostAuthActionImpl extends PostAuthAction
{
    private service : AuthService;
    constructor( service : AuthService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const body : PostAuthAction.Body | null = this.body;
        if( !body || !body.type || !body.target ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "type and target are required" } };

        const created : Type.Result<AuthAction.Entity> = await this.service.actions.create( {
            type:        body.type,
            target:      body.target,
            accountId:   body.accountId,
            userId:      body.userId,
            ttlMinutes:  body.ttlMinutes,
            requestedBy: body.requestedBy ?? auth.userId,
            params:      body.params,
        } );
        if( !created.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not create the action" } };

        const entity : AuthAction.Entity = created.data;
        return { status: NetworkUtils.Status.CREATED, data: { actionId: entity.actionId, path: AuthAction.pathFor( entity.type, entity.actionId ), expiresAt: entity.expiresAt } };
    }
}

export default PostAuthActionImpl;
