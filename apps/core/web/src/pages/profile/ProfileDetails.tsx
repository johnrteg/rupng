import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Button, Card, CardContent, CardHeader, Chip, Divider, Stack, Typography } from "@mui/material";
import CheckCircleOutlineIcon    from '@mui/icons-material/CheckCircleOutlined';
import ErrorOutlineIcon          from '@mui/icons-material/ErrorOutlineOutlined';
import SaveOutlinedIcon          from '@mui/icons-material/SaveOutlined';
import RestartAltOutlinedIcon    from '@mui/icons-material/RestartAltOutlined';
import PhotoCameraOutlinedIcon   from '@mui/icons-material/PhotoCameraOutlined';

import { Access }   from '@repo/system';
import { RestfulService } from '@repo/endpoint';
import { User, Media, PostVerifyResend } from '@repo/api';

import LocaleService   from '@model/service/LocaleService';
import AuthPage        from '@widgets/app/AuthPage';
import TextInput       from '@widgets/core/TextInput';
import EmailInput      from '@widgets/core/EmailInput';
import TelephoneInput  from '@widgets/core/TelephoneInput';
import TimezoneInput   from '@widgets/core/TimezoneInput';
import UserAvatar      from '@widgets/app/UserAvatar';
import AvatarCropDialog from '@pages/profile/dialogs/AvatarCropDialog';

//
// Profile : Details — the signed-in user's identity + contact + regional attributes, grouped into cards
// (one card per logical section) with a single Save action pinned at the bottom. Seeded from the cached
// session profile (auth/GetSession → User.Entity); edits are held in local state and diffed against the
// original so Save/Reset only light up when something actually changed.
//
export function ProfileDetails( props : ProfileDetails.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    // the editable Cognito-owned attributes (the DynamoDB row + verified flags are read-only here)
    const [form,setForm]         = React.useState< ProfileDetails.Form >( () => formFrom( appmodel.auth.user ) );
    const [original,setOriginal] = React.useState< ProfileDetails.Form >( () => formFrom( appmodel.auth.user ) );
    const [saving,setSaving]     = React.useState< boolean >( false );
    const [status,setStatus]     = React.useState< string >( "" );
    const [cropOpen,setCropOpen] = React.useState< boolean >( false );              // the pan/zoom cropper (owns Replace/upload)
    const [avatarAssetId,setAvatarAssetId] = React.useState< string | undefined >( appmodel.auth.user?.avatarAssetId );

    const user : User.Entity | null = appmodel.auth.user;
    const dirty : boolean = JSON.stringify( form ) !== JSON.stringify( original );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // seed the form from the cached User.Entity (Cognito ⊕ DynamoDB read model)
    function formFrom( entity : User.Entity | null ) : ProfileDetails.Form
    {
        return  {
                    firstName:   entity?.firstName   ?? "",
                    lastName:    entity?.lastName    ?? "",
                    displayName: entity?.displayName ?? "",
                    email:       entity?.email       ?? "",
                    phone:       entity?.phone       ?? "",
                    timezone:    entity?.timezone    ?? "",
                };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function set( patch : Partial<ProfileDetails.Form> ) : void
    {
        setStatus( "" );
        setForm( ( prev : ProfileDetails.Form ) => ( { ...prev, ...patch } ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onReset() : void
    {
        setStatus( "" );
        setForm( original );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // build the store-grouped write shape (User.Update). NOTE: the profile-write endpoint
    // (POST /auth/user) is not wired yet — for now Save validates + updates the local view. Once the
    // endpoint exists, POST this payload and re-seed `original` from the response.
    async function onSave() : Promise<void>
    {
        setSaving( true );
        setStatus( "" );
        try
        {
            const update : User.Update =
            {
                cognito:
                {
                    firstName:   form.firstName,
                    lastName:    form.lastName,
                    displayName: form.displayName || undefined,
                    email:       form.email       || undefined,
                    phone:       form.phone       || undefined,
                    timezone:    form.timezone    || undefined,
                }
            };
            appmodel.log.info( "profile.save", update );

            // optimistic local update so the shell (name/menu) reflects the edit immediately
            if( appmodel.auth.user )
                appmodel.auth.setUser( { ...appmodel.auth.user, ...update.cognito } as User.Entity );

            setOriginal( form );
            setStatus( "Profile saved." );
        }
        finally
        {
            setSaving( false );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // open the pan/zoom cropper — re-frames the existing original (kept), or prompts to choose one via Replace…
    function onEditPhoto() : void { setCropOpen( true ); }

    // the cropper saved — reflect the new avatar immediately (the media→auth event syncs the session shortly)
    function onAvatarSaved( assetGuid : string ) : void
    {
        setAvatarAssetId( assetGuid );
        setCropOpen( false );
        if( appmodel.auth.user ) appmodel.auth.setUser( { ...appmodel.auth.user, avatarAssetId: assetGuid } as User.Entity );
        setStatus( "Profile photo updated." );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a locale-formatted date/time (long form) for the read-only rows; blank ISO → em dash
    function displayDate( iso? : string ) : string
    {
        return appmodel.ui.locale.dateTime( iso ? new Date( iso ) : null, LocaleService.Format.LONG ) || "—";
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a small verified/unverified pill for a contact channel
    function verifiedChip( verified : boolean ) : JSX.Element
    {
        return verified
            ? <Chip size="small" color="success" variant="outlined" icon={ <CheckCircleOutlineIcon /> } label={"Verified"} />
            : <Chip size="small" color="warning" variant="outlined" icon={ <ErrorOutlineIcon /> }      label={"Unverified"} />;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // (re)send a verification message for an unverified channel. Email is wired to the app-driven resend
    // (POST /verify/resend → a fresh branded EMAIL_VERIFICATION link via the email service); SMS stays
    // informational until the texting rail is live. Shown only while the channel is unverified.
    async function onResendVerify( channel : "email" | "phone" ) : Promise<void>
    {
        if( channel === "phone" )
        {
            setStatus( "Verification code sent to your phone." );
            return;
        }
        const account : string = user?.email ?? "";
        if( account === "" ) return;
        // the registration token IS the identifier (the email) for the app-driven resend
        const reply : RestfulService.Reply<PostVerifyResend.Response> = await appmodel.server.fetch(
            new PostVerifyResend( { registrationToken: account, origin: window.location.origin } ) );
        setStatus( reply.ok ? "Verification email sent — check your inbox." : "We couldn't send the verification email. Please try again." );
    }

    function resendButton( channel : "email" | "phone" ) : JSX.Element
    {
        return  <Button size="small" variant="outlined" onClick={ () => void onResendVerify( channel ) }>
                    {"Resend"}
                </Button>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // two-column responsive field grid (stacks to one column on narrow content)
    function fieldGrid( children : React.ReactNode ) : JSX.Element
    {
        return  <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
                    { children }
                </Box>;
    }

    return  <AuthPage minAccess={ Access.AccountRole.USER } title={"Profile : Details"}>
                <Box sx={{ p: 2, pb: 12, maxWidth: 880, mx: "auto" }}>{ /* pb clears the sticky action bar */ }

                    <Stack spacing={ 2 }>

                        {/* ── Identity ─────────────────────────────────────────────────────────── */}
                        <Card variant="outlined">
                            <CardHeader title={"Identity"} subheader={"Your name as it appears across the app."} />
                            <Divider />
                            <CardContent>
                                <Stack direction="row" spacing={ 3 } sx={{ alignItems: "flex-start" }}>
                                    {/* avatar + Edit — pan/zoom cropper sets the photo (media-23) */}
                                    <Stack spacing={ 1 } sx={{ alignItems: "center" }}>
                                        <UserAvatar assetId={ avatarAssetId } name={ `${ form.firstName } ${ form.lastName }`.trim() } size={ Media.AvatarSize.LG } px={ 64 } />
                                        <Button size="small" variant="outlined" startIcon={ <PhotoCameraOutlinedIcon /> } onClick={ onEditPhoto }>
                                            { avatarAssetId ? "Edit" : "Add photo" }
                                        </Button>
                                    </Stack>
                                    <Box sx={{ flexGrow: 1 }}>
                                        { fieldGrid( <>
                                            <TextInput id="profile-firstName" label={"First name"} value={ form.firstName } onChange={ ( value ) => set( { firstName: value } ) } fullWidth />
                                            <TextInput id="profile-lastName"  label={"Last name"}  value={ form.lastName }  onChange={ ( value ) => set( { lastName: value } ) }  fullWidth />
                                        </> ) }
                                        <Box sx={{ mt: 2 }}>
                                            <TextInput id="profile-displayName" label={"Display name"} value={ form.displayName } onChange={ ( value ) => set( { displayName: value } ) } fullWidth />
                                        </Box>
                                    </Box>
                                </Stack>
                            </CardContent>
                        </Card>

                        {/* ── Contact ──────────────────────────────────────────────────────────── */}
                        <Card variant="outlined">
                            <CardHeader title={"Contact"} subheader={"How we reach you. Changing these re-triggers verification."} />
                            <Divider />
                            <CardContent>
                                <Stack spacing={ 2 }>
                                    <Stack direction="row" spacing={ 1.5 } sx={{ alignItems: "center" }}>
                                        <Box sx={{ flexGrow: 1 }}>
                                            <EmailInput id="profile-email" label={"Email"} value={ form.email } onChange={ ( value ) => set( { email: value } ) } sx={{ width: "100%" }} />
                                        </Box>
                                        { verifiedChip( user?.emailVerified === true ) }
                                        { user?.emailVerified !== true && resendButton( "email" ) }
                                    </Stack>
                                    <Stack direction="row" spacing={ 1.5 } sx={{ alignItems: "center" }}>
                                        <Box sx={{ flexGrow: 1 }}>
                                            <TelephoneInput id="profile-phone" label={"Phone"} value={ form.phone } onChange={ ( value ) => set( { phone: value } ) } fullWidth />
                                        </Box>
                                        { verifiedChip( user?.phoneVerified === true ) }
                                        { user?.phoneVerified !== true && resendButton( "phone" ) }
                                    </Stack>
                                </Stack>
                            </CardContent>
                        </Card>

                        {/* ── Regional ─────────────────────────────────────────────────────────── */}
                        <Card variant="outlined">
                            <CardHeader title={"Regional"} subheader={"The time zone used to format dates and times."} />
                            <Divider />
                            <CardContent>
                                <TimezoneInput id="profile-timezone"
                                               label={"Time zone"}
                                               value={ form.timezone ? [ form.timezone ] : [] }
                                               only={ Object.values( TimezoneInput.StdZone ) }
                                               valueType={ TimezoneInput.ValueType.CITY }
                                               labelType={ TimezoneInput.LabelType.CITY }
                                               onChange={ ( zones ) => set( { timezone: zones[ 0 ] ?? "" } ) } />
                            </CardContent>
                        </Card>

                        {/* ── Account (read-only) ──────────────────────────────────────────────── */}
                        <Card variant="outlined">
                            <CardHeader title={"Account"} subheader={"Managed by the platform — read-only."} />
                            <Divider />
                            <CardContent>
                                <Stack spacing={ 2 }>
                                    <ReadRow label={"Status"} value={ user?.status ?? "—" } />
                                    <ReadRow label={"Member since"} value={ displayDate( user?.createdAt ) } />
                                    <ReadRow label={"Last sign-in"} value={ displayDate( user?.lastLoginAt ) } />
                                </Stack>
                            </CardContent>
                        </Card>

                    </Stack>
                </Box>

                {/* ── sticky save bar ─────────────────────────────────────────────────────────── */}
                <Box sx={{ position: "sticky", bottom: 0, borderTop: 1, borderColor: "divider", bgcolor: "background.paper", px: 3, py: 1.5 }}>
                    <Stack direction="row" spacing={ 2 } sx={{ alignItems: "center", maxWidth: 880, mx: "auto" }}>
                        { status !== "" && <Typography variant="body2" sx={{ color: "text.secondary" }}>{ status }</Typography> }
                        <Box sx={{ flexGrow: 1 }} />
                        <Button variant="text" color="inherit" startIcon={ <RestartAltOutlinedIcon /> } disabled={ !dirty || saving } onClick={ onReset }>
                            {"Reset"}
                        </Button>
                        <Button variant="contained" startIcon={ <SaveOutlinedIcon /> } disabled={ !dirty || saving } onClick={ () => void onSave() }>
                            {"Save"}
                        </Button>
                    </Stack>
                </Box>

                { cropOpen && user &&
                    <AvatarCropDialog userId={ user.id } assetId={ avatarAssetId } name={ `${ form.firstName } ${ form.lastName }`.trim() } onSaved={ onAvatarSaved } onClose={ () : void => setCropOpen( false ) } /> }
            </AuthPage>;
}

////////////////////////////////////////////////////////////////////////////////////////////////////
// a labelled read-only key/value row (left label, right value)
function ReadRow( { label, value } : { label : string; value : string } ) : JSX.Element
{
    return  <Stack direction="row" spacing={ 2 } sx={{ justifyContent: "space-between" }}>
                <Typography variant="body2" sx={{ color: "text.secondary" }}>{ label }</Typography>
                <Typography variant="body2">{ value }</Typography>
            </Stack>;
}

export namespace ProfileDetails
{
    export interface Form
    {
        firstName   : string;
        lastName    : string;
        displayName : string;
        email       : string;
        phone       : string;
        timezone    : string;
    }

    export interface Props
    {
    }
}

export default ProfileDetails;
// eof
