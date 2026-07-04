import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Button, Card, CardContent, CardHeader, Chip, CircularProgress, Divider, IconButton, List, ListItem, ListItemText, Stack, Tooltip, Typography } from "@mui/material";
import KeyOutlinedIcon           from '@mui/icons-material/KeyOutlined';
import LockResetOutlinedIcon     from '@mui/icons-material/LockResetOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import SendOutlinedIcon          from '@mui/icons-material/SendOutlined';
import SmartphoneOutlinedIcon    from '@mui/icons-material/SmartphoneOutlined';

import { startRegistration, type PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { QRCodeSVG } from "qrcode.react";

import { Access, RestfulService } from '@repo/endpoint';
import { GetPasskeys, DeletePasskey, PostPasskeyRegisterOptions, PostPasskeyRegisterVerify, PostPasswordForgot, PostPasswordReset, PostMfaTotpBegin, PostMfaTotpVerify, DeleteMfaTotp } from '@repo/api';
import { MfaMethod } from '@repo/api';

import LocaleService   from '@model/service/LocaleService';
import AuthPage        from '@widgets/app/AuthPage';
import TextInput       from '@widgets/core/TextInput';
import PasswordInput   from '@widgets/core/PasswordInput';

//
// Profile : Security — the signed-in user's credential controls, one logical panel per card:
//   • Password       — reset via an emailed verification code (send code → enter code + new password).
//   • Passkeys        — list / add (WebAuthn ceremony) / remove the caller's passkeys.
//   • Authenticator   — TOTP app enrolment (not yet wired server-side — see note below).
// Mirrors the Profile : Details card style; each panel owns its own local state + status line.
//
export function ProfileSecurity( props : ProfileSecurity.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const email : string = appmodel.auth.user?.email ?? "";

    // ── password reset ───────────────────────────────────────────────────────────────────────────
    const [codeSent,setCodeSent]   = React.useState< boolean >( false );
    const [code,setCode]           = React.useState< string >( "" );
    const [newPassword,setNewPass] = React.useState< string >( "" );
    const [pwBusy,setPwBusy]       = React.useState< boolean >( false );
    const [pwStatus,setPwStatus]   = React.useState< string >( "" );

    // ── passkeys ─────────────────────────────────────────────────────────────────────────────────
    const [passkeys,setPasskeys]   = React.useState< Array<GetPasskeys.Passkey> >( [] );
    const [pkBusy,setPkBusy]       = React.useState< boolean >( false );
    const [pkStatus,setPkStatus]   = React.useState< string >( "" );

    // ── authenticator app (TOTP) ───────────────────────────────────────────────────────────────
    const [totpUri,setTotpUri]     = React.useState< string >( "" );   // otpauth:// URI while enrolling ("" = not enrolling)
    const [totpSecret,setTotpSec]  = React.useState< string >( "" );   // shown for manual entry
    const [totpCode,setTotpCode]   = React.useState< string >( "" );
    const [totpBusy,setTotpBusy]   = React.useState< boolean >( false );
    const [totpStatus,setTotpStat] = React.useState< string >( "" );
    const [totpEnabled,setTotpOn]  = React.useState< boolean >( appmodel.auth.user?.mfa?.methods?.includes( MfaMethod.TOTP ) === true );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( () => { void loadPasskeys(); }, [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a locale-formatted date/time; blank/invalid → em dash
    function displayDate( iso? : string ) : string
    {
        return appmodel.ui.locale.dateTime( iso ? new Date( iso ) : null, LocaleService.Format.SHORT ) || "—";
    }

    // ── password reset ─────────────────────────────────────────────────────────────────────────
    // Step 1 — email the caller a verification code (enumeration-neutral; the reply is always "sent").
    async function onSendCode() : Promise<void>
    {
        if( email === "" ) return;
        setPwBusy( true );
        setPwStatus( "" );
        const reply : RestfulService.Reply<PostPasswordForgot.Response> = await appmodel.server.fetch( new PostPasswordForgot( { account: email } ) );
        setPwBusy( false );
        if( reply.ok )
        {
            setCodeSent( true );
            setPwStatus( "We sent a verification code to your email." );
        }
        else
        {
            setPwStatus( "Could not start the password reset. Please try again." );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Step 2 — set the new password using the emailed code as proof.
    async function onResetPassword() : Promise<void>
    {
        if( code.trim() === "" || newPassword === "" ) return;
        setPwBusy( true );
        setPwStatus( "" );
        const reply : RestfulService.Reply<PostPasswordReset.Response> = await appmodel.server.fetch(
            new PostPasswordReset( { account: email, code: code.trim(), password: newPassword } ) );
        setPwBusy( false );
        if( reply.ok && reply.data?.ok )
        {
            setCodeSent( false );
            setCode( "" );
            setNewPass( "" );
            setPwStatus( "Your password has been updated." );
        }
        else
        {
            setPwStatus( "That code was invalid or expired, or the password didn't meet the policy." );
        }
    }

    // ── passkeys ─────────────────────────────────────────────────────────────────────────────────
    async function loadPasskeys() : Promise<void>
    {
        const reply : RestfulService.Reply<GetPasskeys.Response> = await appmodel.server.fetch( new GetPasskeys() );
        if( reply.ok && reply.data ) setPasskeys( reply.data.passkeys );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // enrol a passkey: get creation options, run the browser ceremony, verify, then refresh the list
    async function onAddPasskey() : Promise<void>
    {
        setPkBusy( true );
        setPkStatus( "" );
        try
        {
            const optionsReply : RestfulService.Reply<PostPasskeyRegisterOptions.Response> = await appmodel.server.fetch( new PostPasskeyRegisterOptions() );
            if( !optionsReply.ok || !optionsReply.data )
            {
                setPkStatus( "Could not start passkey enrolment — are you signed in?" );
                return;
            }

            const attestation = await startRegistration( { optionsJSON: optionsReply.data.options as unknown as PublicKeyCredentialCreationOptionsJSON } );

            const verifyReply : RestfulService.Reply<PostPasskeyRegisterVerify.Response> = await appmodel.server.fetch(
                new PostPasskeyRegisterVerify( { ceremonyId: optionsReply.data.ceremonyId, response: attestation as unknown as Record<string, unknown> } ) );

            if( verifyReply.ok && verifyReply.data?.verified )
            {
                setPkStatus( "Passkey added." );
                await loadPasskeys();
            }
            else
            {
                setPkStatus( "Passkey enrolment failed." );
            }
        }
        catch( err )
        {
            appmodel.log.warn( "passkey.enrol", err );
            setPkStatus( "Passkey enrolment was cancelled or unavailable." );
        }
        finally
        {
            setPkBusy( false );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function onDeletePasskey( credentialId : string ) : Promise<void>
    {
        setPkBusy( true );
        setPkStatus( "" );
        const reply : RestfulService.Reply<DeletePasskey.Response> = await appmodel.server.fetch( new DeletePasskey( { credentialId } ) );
        setPkBusy( false );
        if( reply.ok && reply.data?.deleted ) await loadPasskeys();
        else setPkStatus( "Could not remove that passkey." );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a short, readable form of the opaque credential id
    function shortId( credentialId : string ) : string
    {
        return credentialId.length > 16 ? `${ credentialId.slice( 0, 8 ) }…${ credentialId.slice( -6 ) }` : credentialId;
    }

    // ── authenticator app (TOTP) ───────────────────────────────────────────────────────────────
    // Step 1 — associate a software token → secret + otpauth URI (rendered as a QR below).
    async function onBeginTotp() : Promise<void>
    {
        setTotpBusy( true );
        setTotpStat( "" );
        const reply : RestfulService.Reply<PostMfaTotpBegin.Response> = await appmodel.server.fetch( new PostMfaTotpBegin() );
        setTotpBusy( false );
        if( reply.ok && reply.data )
        {
            setTotpUri( reply.data.otpauthUri );
            setTotpSec( reply.data.secret );
        }
        else
        {
            setTotpStat( "Could not start authenticator setup. Please try again." );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Step 2 — confirm a 6-digit code; on success TOTP becomes a preferred MFA factor.
    async function onVerifyTotp() : Promise<void>
    {
        if( totpCode.trim().length !== 6 ) return;
        setTotpBusy( true );
        setTotpStat( "" );
        const reply : RestfulService.Reply<PostMfaTotpVerify.Response> = await appmodel.server.fetch( new PostMfaTotpVerify( { code: totpCode.trim() } ) );
        setTotpBusy( false );
        if( reply.ok && reply.data?.verified )
        {
            setTotpOn( true );
            setTotpUri( "" );
            setTotpSec( "" );
            setTotpCode( "" );
            setTotpStat( "Authenticator app enabled." );
        }
        else
        {
            setTotpStat( "That code didn't match. Check your app and try again." );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onCancelTotp() : void
    {
        setTotpUri( "" );
        setTotpSec( "" );
        setTotpCode( "" );
        setTotpStat( "" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // disable the authenticator app — turns off the software-token MFA gate at sign-in
    async function onDisableTotp() : Promise<void>
    {
        setTotpBusy( true );
        setTotpStat( "" );
        const reply : RestfulService.Reply<DeleteMfaTotp.Response> = await appmodel.server.fetch( new DeleteMfaTotp() );
        setTotpBusy( false );
        if( reply.ok && reply.data?.disabled )
        {
            setTotpOn( false );
            setTotpStat( "Authenticator app removed." );
        }
        else
        {
            setTotpStat( "Could not remove the authenticator app. Please try again." );
        }
    }

    return  <AuthPage minAccess={ Access.AccountRole.USER } title={"Profile : Security"}>
                <Box sx={{ p: 2, maxWidth: 880, mx: "auto" }}>

                    <Stack spacing={ 2 }>

                        {/* ── Password ─────────────────────────────────────────────────────────── */}
                        <Card variant="outlined">
                            <CardHeader title={"Password"} subheader={"Reset your password with a verification code sent to your email."} />
                            <Divider />
                            <CardContent>
                                <Stack spacing={ 2 }>
                                    <Typography variant="body2" sx={{ color: "text.secondary" }}>
                                        { email !== "" ? `A code will be sent to ${ email }.` : "No email is on file for this account." }
                                    </Typography>

                                    { !codeSent
                                        ? <Button variant="outlined" startIcon={ <SendOutlinedIcon /> } disabled={ pwBusy || email === "" } onClick={ () => void onSendCode() } sx={{ alignSelf: "flex-start" }}>
                                              {"Send reset code"}
                                          </Button>
                                        : <>
                                              <TextInput id="security-reset-code" label={"Verification code"} value={ code } onChange={ setCode } fullWidth />
                                              <PasswordInput id="security-new-password" label={"New password"} value={ newPassword } autoComplete="new-password" onChange={ setNewPass } />
                                              <Stack direction="row" spacing={ 1 }>
                                                  <Button variant="contained" startIcon={ <LockResetOutlinedIcon /> } disabled={ pwBusy || code.trim() === "" || newPassword === "" } onClick={ () => void onResetPassword() }>
                                                      {"Update password"}
                                                  </Button>
                                                  <Button variant="text" color="inherit" disabled={ pwBusy } onClick={ () => void onSendCode() }>
                                                      {"Resend code"}
                                                  </Button>
                                              </Stack>
                                          </>
                                    }

                                    { pwStatus !== "" && <Typography variant="body2" sx={{ color: "text.secondary" }}>{ pwStatus }</Typography> }
                                </Stack>
                            </CardContent>
                        </Card>

                        {/* ── Passkeys ─────────────────────────────────────────────────────────── */}
                        <Card variant="outlined">
                            <CardHeader title={"Passkeys"} subheader={"Sign in without a password using this device's biometrics or a security key."} />
                            <Divider />
                            <CardContent>
                                <Stack spacing={ 2 }>
                                    { passkeys.length === 0
                                        ? <Typography variant="body2" sx={{ color: "text.secondary" }}>{"No passkeys yet."}</Typography>
                                        : <List dense disablePadding>
                                              { passkeys.map( ( passkey : GetPasskeys.Passkey ) =>
                                                  <ListItem key={ passkey.credentialId } disableGutters
                                                            secondaryAction={
                                                                <Tooltip title={"Remove"}>
                                                                    <span>
                                                                        <IconButton edge="end" disabled={ pkBusy } onClick={ () => void onDeletePasskey( passkey.credentialId ) }>
                                                                            <DeleteOutlineOutlinedIcon />
                                                                        </IconButton>
                                                                    </span>
                                                                </Tooltip>
                                                            }>
                                                      <KeyOutlinedIcon sx={{ mr: 1.5, color: "text.secondary" }} />
                                                      <ListItemText primary={ shortId( passkey.credentialId ) } secondary={ `Added ${ displayDate( passkey.createdAt ) }` }
                                                                    sx={{ "& .MuiListItemText-primary": { fontFamily: "monospace" } }} />
                                                  </ListItem>
                                              ) }
                                          </List>
                                    }
                                    <Button variant="outlined" startIcon={ <KeyOutlinedIcon /> } disabled={ pkBusy } onClick={ () => void onAddPasskey() } sx={{ alignSelf: "flex-start" }}>
                                        {"Add a passkey"}
                                    </Button>
                                    { pkStatus !== "" && <Typography variant="body2" sx={{ color: "text.secondary" }}>{ pkStatus }</Typography> }
                                </Stack>
                            </CardContent>
                        </Card>

                        {/* ── Authenticator app (TOTP) ─────────────────────────────────────────── */}
                        <Card variant="outlined">
                            <CardHeader title={"Authenticator app"}
                                        subheader={"Use a time-based one-time code from an app like Google Authenticator or 1Password."}
                                        action={ totpEnabled ? <Chip size="small" color="success" variant="outlined" label={"Enabled"} sx={{ mt: 1, mr: 1 }} /> : null } />
                            <Divider />
                            <CardContent>
                                <Stack spacing={ 2 }>
                                    { totpEnabled && totpUri === "" &&
                                        <>
                                            <Typography variant="body2" sx={{ color: "text.secondary" }}>{"An authenticator app is set up for this account."}</Typography>
                                            <Button variant="outlined" color="error" startIcon={ <DeleteOutlineOutlinedIcon /> } disabled={ totpBusy } onClick={ () => void onDisableTotp() } sx={{ alignSelf: "flex-start" }}>
                                                {"Remove"}
                                            </Button>
                                        </>
                                    }

                                    { !totpEnabled && totpUri === "" &&
                                        <>
                                            <Typography variant="body2" sx={{ color: "text.secondary" }}>
                                                {"Scan a QR code once, then enter a 6-digit code at sign-in."}
                                            </Typography>
                                            <Button variant="outlined" startIcon={ <SmartphoneOutlinedIcon /> } disabled={ totpBusy } onClick={ () => void onBeginTotp() } sx={{ alignSelf: "flex-start" }}>
                                                {"Set up"}
                                            </Button>
                                        </>
                                    }

                                    { totpUri !== "" &&
                                        <>
                                            <Typography variant="body2" sx={{ color: "text.secondary" }}>
                                                {"Scan this with your authenticator app, then enter the 6-digit code it shows."}
                                            </Typography>
                                            <Box sx={{ bgcolor: "#fff", p: 1.5, borderRadius: 1, alignSelf: "flex-start", lineHeight: 0 }}>
                                                <QRCodeSVG value={ totpUri } size={ 168 } level="M" />
                                            </Box>
                                            <Typography variant="caption" sx={{ color: "text.secondary" }}>
                                                {"Can't scan? Enter this key manually: "}<Box component="span" sx={{ fontFamily: "monospace" }}>{ totpSecret }</Box>
                                            </Typography>
                                            <TextInput id="security-totp-code" label={"6-digit code"} value={ totpCode } onChange={ setTotpCode } sx={{ width: 200 }} />
                                            <Stack direction="row" spacing={ 1 }>
                                                <Button variant="contained" disabled={ totpBusy || totpCode.trim().length !== 6 } onClick={ () => void onVerifyTotp() }>
                                                    {"Verify & enable"}
                                                </Button>
                                                <Button variant="text" color="inherit" disabled={ totpBusy } onClick={ onCancelTotp }>
                                                    {"Cancel"}
                                                </Button>
                                            </Stack>
                                        </>
                                    }

                                    { totpStatus !== "" && <Typography variant="body2" sx={{ color: "text.secondary" }}>{ totpStatus }</Typography> }
                                </Stack>
                            </CardContent>
                        </Card>

                    </Stack>
                </Box>
            </AuthPage>;
}

export namespace ProfileSecurity
{
    export interface Props
    {
    }
}

export default ProfileSecurity;
// eof
