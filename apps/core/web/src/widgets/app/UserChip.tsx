import React from 'react';
import { JSX } from "react";

import { Box, Chip, Divider, Popover, Stack, Typography } from "@mui/material";
import EmailOutlinedIcon      from '@mui/icons-material/EmailOutlined';
import SmsOutlinedIcon        from '@mui/icons-material/SmsOutlined';
import ChatOutlinedIcon       from '@mui/icons-material/ChatOutlined';
import PhoneOutlinedIcon      from '@mui/icons-material/PhoneOutlined';

import { Media } from '@repo/api';

import ButtonIcon from '@widgets/core/ButtonIcon';
import UserAvatar from '@widgets/app/UserAvatar';

//
// UserChip — a compact, clickable representation of a person in the system: an avatar + their name (a Chip).
// Clicking it opens a card with a larger photo, name, optional title/company/location, and their email/phone,
// plus a row of contact actions (chat / text / email). The actions are placeholders for now (disabled) — the
// wiring lands later. Purely presentational: the caller passes the user's details.
//
export function UserChip( props : UserChip.Props ) : JSX.Element
{
    const [anchor,setAnchor] = React.useState< HTMLElement | null >( null );

    // open/close the detail card
    function open( event : React.MouseEvent<HTMLElement> ) : void { setAnchor( event.currentTarget ); }
    function close() : void { setAnchor( null ); }

    // the subtitle line — "Title @ Company" when either is set
    const subtitle : string = [ props.title, props.company ].filter( ( value? : string ) : boolean => !!value && value.trim() !== "" ).join( " @ " );

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <>
                <Chip avatar={ <UserAvatar assetId={ props.assetId } name={ props.name } size={ Media.AvatarSize.XS } /> }
                      label={ props.name }
                      size={ props.size ?? "medium" }
                      variant="outlined"
                      clickable
                      onClick={ open } />

                <Popover open={ anchor !== null } anchorEl={ anchor } onClose={ close }
                         anchorOrigin={{ vertical: "bottom", horizontal: "left" }}>
                    <Stack spacing={ 1.5 } sx={{ p: 2, width: 320 }}>
                        {/* header — larger photo + name / title / location */}
                        <Stack direction="row" spacing={ 1.5 } sx={{ alignItems: "center" }}>
                            <UserAvatar assetId={ props.assetId } name={ props.name } size={ Media.AvatarSize.LG } px={ 56 } />
                            <Stack spacing={ 0 } sx={{ minWidth: 0 }}>
                                <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }}>{ props.name }</Typography>
                                { subtitle !== "" && <Typography variant="caption" sx={{ color: "text.secondary" }}>{ subtitle }</Typography> }
                                { props.location && <Typography variant="caption" sx={{ color: "text.secondary" }}>{ props.location }</Typography> }
                            </Stack>
                        </Stack>

                        {/* contact rows */}
                        { ( props.email || props.phone ) &&
                            <Stack spacing={ 0.5 }>
                                { props.email &&
                                    <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", color: "text.secondary" }}>
                                        <EmailOutlinedIcon fontSize="small" />
                                        <Typography variant="body2" sx={{ color: "text.primary", wordBreak: "break-all" }}>{ props.email }</Typography>
                                    </Stack> }
                                { props.phone &&
                                    <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", color: "text.secondary" }}>
                                        <PhoneOutlinedIcon fontSize="small" />
                                        <Typography variant="body2" sx={{ color: "text.primary" }}>{ props.phone }</Typography>
                                    </Stack> }
                            </Stack> }

                        <Divider />

                        {/* contact actions — placeholders until wired (chat / text / email) */}
                        <Stack direction="row" spacing={ 1 } sx={{ justifyContent: "center" }}>
                            <ButtonIcon id="userchip-chat"  label={"Chat (coming soon)"}  color="primary" disabled icon={ <ChatOutlinedIcon fontSize="small" /> } onClick={ close } />
                            <ButtonIcon id="userchip-text"  label={"Text (coming soon)"}  color="primary" disabled icon={ <SmsOutlinedIcon fontSize="small" /> } onClick={ close } />
                            <ButtonIcon id="userchip-email" label={"Email (coming soon)"} color="primary" disabled icon={ <EmailOutlinedIcon fontSize="small" /> } onClick={ close } />
                        </Stack>
                    </Stack>
                </Popover>
            </>;
}

export namespace UserChip
{
    export interface Props
    {
        name       : string;
        email?     : string;
        phone?     : string;
        assetId?   : string;   // the person's avatar media asset guid (User.avatarAssetId) → UserAvatar resolves it
        title?     : string;
        company?   : string;
        location?  : string;
        size?      : "small" | "medium";
    }
}

export default UserChip;
// eof
