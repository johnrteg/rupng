import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Avatar } from "@mui/material";
import { SxProps, Theme } from "@mui/material/styles";

import { Media, GetMediaUrl } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

//
// UserAvatar — the ONE way to render a user's profile photo. Given the avatar media asset guid + a `size`, it
// resolves the matching square AVATAR variant (media-23) from the media service and renders a circular MUI
// Avatar, falling back to the user's initials when there's no asset (or it hasn't finished processing — the
// media service serves the original meanwhile). Resolved URLs are cached per (guid,size) so the many surfaces
// that show avatars (nav, chips, profile) don't each re-resolve. `size` picks BOTH the variant and a sensible
// default rendered pixel size (override with `px`).
//
export function UserAvatar( props : UserAvatar.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const size : Media.AvatarSize = props.size ?? Media.AvatarSize.MD;
    const px : number = props.px ?? UserAvatar.RENDER_PX[ size ];
    const cacheKey : string = props.assetId ? `${ props.assetId }.${ size }` : "";

    const [url,setUrl] = React.useState< string | null >( () => cacheKey !== "" ? ( UserAvatar.CACHE.get( cacheKey ) ?? null ) : null );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( () : void => { void resolve(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ props.assetId, size ] );

    // resolve the avatar variant's delivery URL (cached per guid+size); the media service falls back to the
    // ORIGINAL while the variants are still processing
    async function resolve() : Promise<void>
    {
        if( props.assetId === undefined || props.assetId === "" ) { setUrl( null ); return; }
        const cached : string | undefined = UserAvatar.CACHE.get( cacheKey );
        if( cached !== undefined ) { setUrl( cached ); return; }
        const reply : RestfulService.Reply<GetMediaUrl.Response> = await appmodel.server.fetch( new GetMediaUrl( props.assetId, `${ Media.Usage.AVATAR }.${ size }` ) );
        if( reply.ok && reply.data ) { UserAvatar.CACHE.set( cacheKey, reply.data.url ); setUrl( reply.data.url ); }
    }

    // the initials fallback — first letters of the first two name words
    const initials : string = ( props.name ?? "" ).trim().split( /\s+/ ).slice( 0, 2 ).map( ( part : string ) : string => part.charAt( 0 ).toUpperCase() ).join( "" );

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <Avatar src={ url ?? undefined } alt={ props.name } sx={{ width: px, height: px, fontSize: px * 0.4, ...props.sx }}>
                { initials }
            </Avatar>;
}

export namespace UserAvatar
{
    /** Default rendered pixel size per variant (override with `px`). */
    export const RENDER_PX : Record<Media.AvatarSize, number> =
    {
        [ Media.AvatarSize.XL ]: 112,
        [ Media.AvatarSize.LG ]: 64,
        [ Media.AvatarSize.MD ]: 40,
        [ Media.AvatarSize.SM ]: 32,
        [ Media.AvatarSize.XS ]: 24,
    };

    /** Module-wide resolved-URL cache (guid.size → delivery URL) so avatars don't re-resolve across surfaces. */
    export const CACHE : Map<string, string> = new Map<string, string>();

    export interface Props
    {
        assetId? : string;              // the user's avatar media asset guid (User.avatarAssetId)
        name?    : string;              // for the initials fallback + alt text
        size?    : Media.AvatarSize;    // which variant to resolve (default MD)
        px?      : number;              // override the rendered pixel size
        sx?      : SxProps<Theme>;
    }
}

export default UserAvatar;
// eof
