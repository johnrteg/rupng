//
import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";

import { PostSocialDataDeletion } from "@repo/api";
import { NetworkUtils } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import SocialService from "../services/SocialService";

//
// Meta's Data Deletion Request callback (SPECS.md §6.4.4) — verifies the `signed_request`, then
// returns the required `{ url, confirmation_code }` Meta polls for status. The actual per-user inbound
// erasure sweep (find + delete InboundItems whose authorHandle matches the deleted user across all
// accounts) is a follow-up — logged here as a to-do rather than a full table scan, since Meta mostly
// signals app-authorized users, and TTL + source-delete reconciliation already bound how long inbound
// lingers (SPECS.md's primary erasure paths).
//
export class PostSocialDataDeletionImpl extends PostSocialDataDeletion
{
    private service : SocialService;
    constructor( service : SocialService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const signedRequest : string = this.body?.signed_request ?? "";
        const appSecret : string = process.env.META_APP_SECRET ?? "";
        const parsed : { user_id? : string } | null = this.verify( signedRequest, appSecret );
        if( !parsed ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "invalid signed_request" } };

        this.service.log.info( "meta data-deletion request received (erasure sweep is a follow-up)", { userId: parsed.user_id } );

        const confirmationCode : string = randomUUID();
        return { status: NetworkUtils.Status.OK, data: {
            url: `https://${ process.env.APP_DOMAIN ?? "app.example.com" }/data-deletion/status/${ confirmationCode }`,
            confirmation_code: confirmationCode,
        } };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Decode + verify Meta's `signed_request` — `base64url(hmacSha256).base64url(jsonPayload)`. */
    private verify( signedRequest : string, appSecret : string ) : { user_id? : string } | null
    {
        const parts : Array<string> = signedRequest.split( "." );
        if( parts.length !== 2 || !appSecret ) return null;
        const [ encodedSignature, encodedPayload ] = parts;

        const expected : Buffer = createHmac( "sha256", appSecret ).update( encodedPayload ).digest();
        const provided : Buffer = Buffer.from( encodedSignature, "base64url" );
        if( expected.length !== provided.length || !timingSafeEqual( expected, provided ) ) return null;

        try { return JSON.parse( Buffer.from( encodedPayload, "base64url" ).toString( "utf8" ) ); }
        catch { return null; }
    }
}

export default PostSocialDataDeletionImpl;
