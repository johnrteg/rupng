//
import { SocialAccount } from "@repo/api";
import { SocialAdapter } from "./SocialAdapter";
import { LinkedInAdapter } from "./LinkedInAdapter";
import { FacebookAdapter } from "./FacebookAdapter";
import { InstagramAdapter } from "./InstagramAdapter";
import { XAdapter } from "./XAdapter";
import { TikTokAdapter } from "./TikTokAdapter";

//
// AdapterFactory — resolves the native SocialAdapter for a platform. All five Phase 1 networks
// (Facebook, Instagram, X, TikTok, LinkedIn) are registered; Phase 2 (Reddit, Pinterest, YouTube,
// Snapchat, Threads) lands here the same way when their turn comes (SPECS.md §11.2).
//
export class AdapterFactory
{
    private static readonly registry : Map<SocialAccount.Platform, SocialAdapter> = new Map<SocialAccount.Platform, SocialAdapter>( [
        [ SocialAccount.Platform.LINKEDIN,  new LinkedInAdapter() ],
        [ SocialAccount.Platform.FACEBOOK,  new FacebookAdapter() ],
        [ SocialAccount.Platform.INSTAGRAM, new InstagramAdapter() ],
        [ SocialAccount.Platform.X,         new XAdapter() ],
        [ SocialAccount.Platform.TIKTOK,    new TikTokAdapter() ],
    ] );

    /** The adapter for a platform, or `undefined` if that platform isn't wired yet. */
    public static for( platform : SocialAccount.Platform ) : SocialAdapter | undefined { return AdapterFactory.registry.get( platform ); }
}

export default AdapterFactory;
