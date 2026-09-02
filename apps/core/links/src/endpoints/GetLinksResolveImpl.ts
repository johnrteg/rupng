//
import { GetLinksResolve, Links } from "@repo/api";
import { NetworkUtils, UserAgent, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import LinksService from "../services/LinksService";

//
// The redirect (links-2) — MVP stand-in for `<short-domain>/<code>` (see GetLinksResolve's docs).
// lookup -> validate (code + status + expiry) -> classify UA -> enqueue the touch -> 302. The touch
// enqueue is awaited (a fast SQS put), never the analytics publish itself — record-then-redirect.
//
export class GetLinksResolveImpl extends GetLinksResolve
{
    private service : LinksService;
    constructor( service : LinksService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const code : string = this.query?.code ?? "";
        if( !code ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "code required" } };

        const found : Type.Result<Links.TrackedLink | undefined> = await this.service.lookup( code );
        if( !found.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "link read failed" } };
        if( !found.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "unknown code" } };
        const link : Links.TrackedLink = found.data;

        if( link.expiresAt && link.expiresAt < new Date().toISOString() )
            return { status: NetworkUtils.Status.GONE, data: { message: "expired code" } };
        if( link.status === Links.LinkStatus.HIBERNATED || link.status === Links.LinkStatus.TAKEN_DOWN )
            return { status: NetworkUtils.Status.FORBIDDEN, data: { message: "this link is unavailable" } };

        // classify the UA (bot/scraper) — TAGS the touch, never blocks the redirect (links-2.8)
        const ua : UserAgent.Info = UserAgent.parse( this.query?.[ "user-agent" ] );
        const isBot : boolean = ua.bot !== undefined;

        // print is always a QR scan; every other channel is a link click (no query param distinguishes
        // them — the channel the link was minted for already implies which)
        const kind : "clicked" | "scanned" = link.channel === "print" ? "scanned" : "clicked";
        await this.service.enqueueTouch( link, kind, isBot );

        return { status: NetworkUtils.Status.FOUND, data: { target: link.target }, headers: { Location: link.target } };
    }
}

export default GetLinksResolveImpl;
// eof
