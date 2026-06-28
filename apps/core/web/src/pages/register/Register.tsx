//
import React from 'react';
import { JSX } from "react";

//
import { Box, Paper, Stack, Button, Divider } from '@mui/material';
import { ToggleButton, ToggleButtonGroup } from '@mui/material';

//
import ArrowBackIcon        from '@mui/icons-material/ArrowBack';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import CheckCircleOutlineOutlinedIcon from '@mui/icons-material/CheckCircleOutlineOutlined';

// SSO provider icons (sign up with …)
import GoogleIcon           from '@mui/icons-material/Google';
import MicrosoftIcon        from '@mui/icons-material/Microsoft';
import AppleIcon            from '@mui/icons-material/Apple';
import BusinessIcon         from '@mui/icons-material/Business';

//
import { EmailUtils } from "@repo/common";
import { PostRegister, PostRegisterVerify } from "@repo/api";
import { RestfulService } from "@repo/endpoint";

//
import AppModel             from "@model/AppModel";
import AppRouter            from "@main/AppRouter";

//
import Page                 from "@pages/common/Page";

//
import ImageInput           from "@widgets/core/ImageInput";
import EmailInput           from "@widgets/core/EmailInput";
import TelephoneInput       from "@widgets/core/TelephoneInput";
import PasswordInput        from "@widgets/core/PasswordInput";
import TextInput            from "@widgets/core/TextInput";
import CheckboxInput        from "@widgets/core/CheckboxInput";
import ButtonIcon           from "@widgets/core/ButtonIcon";
import LegalScroll          from "@widgets/core/LegalScroll";
import TextLabel            from "@widgets/core/TextLabel";
import LinkButton           from "@widgets/core/LinkButton";
import ErrorMessage         from "@widgets/core/ErrorMessage";
import Show                 from "@widgets/core/Show";

import PdfUtils             from "@utils/PdfUtils";



//
// New-account sign-up — a multi-step wizard:
//   IDENTIFIER → PROFILE → PASSWORD → BOT → VERIFY → done
//
//   1. IDENTIFIER — email OR phone (or sign up with SSO). We then check whether an account already
//      exists for that identifier (STUBBED here — always treated as new).
//   2. PROFILE    — first/last name + account name (only reached for a *new* account).
//   3. PASSWORD   — set + confirm the password, accept the ToS (scroll-to-bottom gates the checkbox;
//                   the ToS can be downloaded as a PDF).
//   4. BOT        — anti-bot verification (stub).
//   5. VERIFY     — emailed/texted code (stub; email verification to-implement).
//
// The existence check, bot check, code verification, and auth calls are STUBBED — see
// apps/core/auth/specs/REGISTRATION.md.
//
export function Register( props : Register.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    // wizard position + which contact method identifies the account
    const [step,setStep]            = React.useState< Register.Step >( Register.Step.IDENTIFIER );
    const [method,setMethod]        = React.useState< Register.Method >( Register.Method.EMAIL );

    // IDENTIFIER
    const [email,setEmail]              = React.useState< string >( "" );
    const [phone,setPhone]              = React.useState< string >( "" );

    // PROFILE
    const [firstName,setFirstName]      = React.useState< string >( "" );
    const [lastName,setLastName]        = React.useState< string >( "" );
    const [accountName,setAccountName]  = React.useState< string >( "" );

    // PASSWORD
    const [password,setPassword]        = React.useState< string >( "" );
    const [confirm,setConfirm]          = React.useState< string >( "" );
    const [tosRead,setTosRead]          = React.useState< boolean >( false );   // scrolled ToS to the bottom?
    const [agreed,setAgreed]            = React.useState< boolean >( false );
    const [downloadingTos,setDownloadingTos] = React.useState< boolean >( false );

    // VERIFY
    const [code,setCode]                = React.useState< string >( "" );

    // server flow — the token from POST /register threaded into POST /register/verify; submitting gates buttons
    const [registrationToken,setRegistrationToken] = React.useState< string >( "" );
    const [submitting,setSubmitting]    = React.useState< boolean >( false );

    const [error,setError]              = React.useState< string >( "" );


    ////////////////////////////////////////////////////////////////////////////////////////////
    // per-step validity
    const identifierValid : boolean = method === Register.Method.EMAIL ? EmailUtils.isValid( email ) : appmodel.ui.locale.phoneValid( phone );
    const profileValid    : boolean = firstName.trim().length > 0 && lastName.trim().length > 0 && accountName.trim().length > 0;
    const passwordValid   : boolean = password.length >= Register.MIN_PASSWORD;
    const confirmMatches  : boolean = confirm.length > 0 && confirm === password;
    const passwordStepValid : boolean = passwordValid && confirmMatches;
    const termsValid      : boolean = agreed;   // ToS accepted on the final step

    const codeValid : boolean = code.trim().length === Register.CODE_LENGTH;

    // human-readable identifier echoed on the verify step (phone pretty-printed via locale)
    const identifierDisplay : string = method === Register.Method.EMAIL ? email : appmodel.ui.locale.phone( phone );

    // confirm-password gets an inline error once something's typed and it doesn't match
    const confirmError : string = confirm.length > 0 && !confirmMatches ? "Passwords do not match" : "";


    ////////////////////////////////////////////////////////////////////////////////////////////
    // STUB — does an account already exist for this identifier? For now, always "no" (new account).
    // TODO: ask auth (enumeration-neutral) — GET /api/auth/v1/exists or fold into POST /register.
    function accountExists( identifier : string ) : boolean
    {
        appmodel.log.info( "register.exists?", { method, identifier } );
        return false;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // IDENTIFIER "Continue" → check for an existing account, then collect the profile.
    function onContinueIdentifier() : void
    {
        if( !identifierValid ) return;
        setError( "" );

        const identifier : string = method === Register.Method.EMAIL ? email : phone;
        if( accountExists( identifier ) )
        {
            // TODO: route to sign-in (pre-filled) / "account exists — sign in instead" messaging.
            setError( "An account already exists for that email or phone. Try signing in." );
            return;
        }
        setStep( Register.Step.PROFILE );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // PROFILE "Continue" → set a password.
    function onContinueProfile() : void
    {
        if( !profileValid ) return;
        setError( "" );
        setStep( Register.Step.PASSWORD );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // PASSWORD "Continue" → bot verification. (Account isn't created until after the bot check.)
    function onContinuePassword() : void
    {
        if( !passwordStepValid ) return;
        setError( "" );
        setStep( Register.Step.BOT );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // BOT "Continue" → advance to the ToS review. (Account isn't created until the ToS is accepted.)
    // TODO: integrate the real anti-bot widget (CAPTCHA / Cloudflare Turnstile / hCaptcha) and only
    //       enable Continue on a passing token; pass that token to POST /register as `botToken`.
    function onContinueBot() : void
    {
        setError( "" );
        setStep( Register.Step.TERMS );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the account identifier (email or E.164 phone) for the current method.
    const identifier : string = method === Register.Method.EMAIL ? email : phone;

    ////////////////////////////////////////////////////////////////////////////////////////////
    // TERMS "Agree & Create Account" → create the account. POST /register creates the pending account
    // (Cognito sign-up) AND triggers the email/SMS verification code; we then advance to VERIFY to
    // confirm that code. Enumeration-neutral: an existing identifier returns OK with a token all the same.
    async function onConfirmTerms() : Promise<void>
    {
        if( !termsValid || submitting ) return;
        setError( "" );
        setSubmitting( true );
        try
        {
            const reply : RestfulService.Reply<PostRegister.Response> = await appmodel.server.fetch( new PostRegister( {
                method, account: identifier, firstName, lastName, accountName, password, acceptedTerms: agreed,
            } ) );
            if( reply.ok && reply.data?.registrationToken )
            {
                setRegistrationToken( reply.data.registrationToken );
                setStep( Register.Step.VERIFY );
            }
            else
            {
                setError( "We couldn't create your account. Please try again." );
            }
        }
        catch( err )
        {
            appmodel.log.warn( "register.create", err );
            setError( "We couldn't create your account. Please try again." );
        }
        finally { setSubmitting( false ); }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // VERIFY "Verify" → confirm the emailed/texted code (POST /register/verify). On success the account
    // is activated → show the success panel.
    async function onVerify() : Promise<void>
    {
        if( !codeValid || submitting ) return;
        setError( "" );
        setSubmitting( true );
        try
        {
            const reply : RestfulService.Reply<PostRegisterVerify.Response> = await appmodel.server.fetch(
                new PostRegisterVerify( { registrationToken, code } ) );
            if( reply.ok && reply.data?.complete )
            {
                setStep( Register.Step.SUCCESS );
            }
            else
            {
                setError( "That code isn't right or has expired. Please try again." );
            }
        }
        catch( err )
        {
            appmodel.log.warn( "register.verify", err );
            setError( "We couldn't verify that code. Please try again." );
        }
        finally { setSubmitting( false ); }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // TODO: re-send the verification code — POST /api/auth/v1/register/resend.
    function onResend() : void
    {
        appmodel.log.info( "register.resend", { method } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // SUCCESS "Sign In" → go to sign-in, pre-filling the account (?account=<identifier>) so login can
    // auto-select the email/phone tab + fill the field.
    function onComplete() : void
    {
        appmodel.goto( AppRouter.Route.LOGIN, undefined, { account: identifier } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // sign up with SSO (from the IDENTIFIER step) — mirrors the login SSO options.
    // TODO: kick off the OIDC/OAuth flow via auth + @repo/oauth; on callback, create/sign in the account.
    function onSso( provider : Register.SsoProvider ) : void
    {
        appmodel.log.info( "register.sso", provider );
    }

    function onEnterpriseSso() : void
    {
        appmodel.log.info( "register.sso.enterprise" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // download the Terms of Service as a PDF (lazy-loads the PDF stack on first use)
    async function onDownloadTos() : Promise<void>
    {
        if( downloadingTos ) return;
        setDownloadingTos( true );
        try { await PdfUtils.downloadUrlAsPdf( Register.TERMS_URL, "terms.pdf" ); }
        finally { setDownloadingTos( false ); }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Back — step-aware: walk back one step; from the first step leave to sign-in.
    function onBack() : void
    {
        setError( "" );
        if( step === Register.Step.VERIFY )        setStep( Register.Step.TERMS );
        else if( step === Register.Step.TERMS )    setStep( Register.Step.BOT );
        else if( step === Register.Step.BOT )      setStep( Register.Step.PASSWORD );
        else if( step === Register.Step.PASSWORD ) setStep( Register.Step.PROFILE );
        else if( step === Register.Step.PROFILE )  setStep( Register.Step.IDENTIFIER );
        else                                       appmodel.goto( AppRouter.Route.LOGIN );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the active step's primary action (also the <form> submit / Enter key)
    function onSubmit( event : React.FormEvent<HTMLFormElement> ) : void
    {
        event.preventDefault();
        if( step === Register.Step.IDENTIFIER )    onContinueIdentifier();
        else if( step === Register.Step.PROFILE )  onContinueProfile();
        else if( step === Register.Step.PASSWORD ) onContinuePassword();
        else if( step === Register.Step.BOT )      onContinueBot();
        else if( step === Register.Step.TERMS )    void onConfirmTerms();
        else if( step === Register.Step.VERIFY )   void onVerify();
    }


    // step heading shown under the title
    const stepLabel : string =
          step === Register.Step.IDENTIFIER ? "Create your account"
        : step === Register.Step.PROFILE    ? "Tell us about you"
        : step === Register.Step.PASSWORD   ? "Set your password"
        : step === Register.Step.BOT        ? "Verify you're human"
        : step === Register.Step.TERMS      ? "Review & accept the terms"
        : step === Register.Step.VERIFY     ? "Verify your " + ( method === Register.Method.EMAIL ? "email" : "phone" )
        :                                     "You're all set";


    // ==================================================================================================================================
    return <Page noNotify={ true }>
                <Box sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", p: 2 }}>
                    <Paper elevation={ 3 } sx={{ p: 4, width: "100%", maxWidth: 460, borderRadius: 2 }}>
                        <Stack direction="column" spacing={ 2 }>

                            {/* same whitelabel banner as the login page */}
                            <ImageInput id="register-banner"
                                        value={ appmodel.ui.getHeaderImageUrl() }
                                        alt={ appmodel.label( "page.login.banner.alt" ) }
                                        defaultSrc="/assets/banner/default.png"
                                        maxWidth={ 240 }
                                        maxHeight={ 80 }
                                        sx={{ alignSelf: "center" }} />

                            {/* title row — Back pinned left, the step label centered */}
                            <Box sx={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 40 }}>
                                <Show show={ step !== Register.Step.SUCCESS }>
                                    <Button size="small" color="inherit" startIcon={ <ArrowBackIcon fontSize="small" /> } onClick={ onBack } sx={{ position: "absolute", left: 0 }}>Back</Button>
                                </Show>
                                <TextLabel variant="h5" align="center" value={ stepLabel } />
                            </Box>

                            <Box component="form" onSubmit={ onSubmit }>
                                <Stack direction="column" spacing={ 2 }>

                                    {/* STEP 1 — IDENTIFIER (email/phone) + SSO */}
                                    <Show show={ step === Register.Step.IDENTIFIER }>
                                        <ToggleButtonGroup exclusive
                                                        fullWidth
                                                        size="small"
                                                        value={ method }
                                                        onChange={ ( _e : React.MouseEvent, value : Register.Method | null ) => { if( value ) setMethod( value ); } }>
                                            <ToggleButton value={ Register.Method.EMAIL }>Email</ToggleButton>
                                            <ToggleButton value={ Register.Method.PHONE }>Phone</ToggleButton>
                                        </ToggleButtonGroup>

                                        <Show show={ method === Register.Method.EMAIL }>
                                            <EmailInput id="register-email" label="Email" value={ email } autoComplete="email" onChange={ setEmail } />
                                        </Show>
                                        <Show show={ method === Register.Method.PHONE }>
                                            <TelephoneInput id="register-phone" label="Phone" value={ phone } fullWidth autoComplete="tel" onChange={ setPhone } />
                                        </Show>

                                        <Button type="submit" variant="contained" fullWidth disabled={ !identifierValid }>Continue</Button>

                                        {/* sign up with SSO (type="button" so they don't submit the form) */}
                                        <Divider>Or sign up with</Divider>
                                        <Stack direction="column" spacing={ 1 }>
                                            <Button type="button" fullWidth variant="outlined" startIcon={ <GoogleIcon /> } onClick={ () => onSso( Register.SsoProvider.GOOGLE ) }>Google</Button>
                                            <Button type="button" fullWidth variant="outlined" startIcon={ <MicrosoftIcon /> } onClick={ () => onSso( Register.SsoProvider.MICROSOFT ) }>Microsoft</Button>
                                            <Button type="button" fullWidth variant="outlined" startIcon={ <AppleIcon /> } onClick={ () => onSso( Register.SsoProvider.APPLE ) }>Apple</Button>
                                            <Button type="button" fullWidth variant="text" startIcon={ <BusinessIcon /> } onClick={ onEnterpriseSso }>Enterprise</Button>
                                        </Stack>
                                    </Show>

                                    {/* STEP 2 — PROFILE (name + account) */}
                                    <Show show={ step === Register.Step.PROFILE }>
                                        <Stack direction="row" spacing={ 2 }>
                                            <TextInput id="register-first" label={"First name"} value={ firstName } autoComplete="given-name" onChange={ setFirstName } />
                                            <TextInput id="register-last"  label={"Last name"}  value={ lastName }  autoComplete="family-name" onChange={ setLastName } />
                                        </Stack>
                                        <TextInput id="register-account" label={"Account name"} value={ accountName } autoComplete="organization" onChange={ setAccountName } />

                                        <Button type="submit" variant="contained" fullWidth disabled={ !profileValid }>Continue</Button>
                                    </Show>

                                    {/* STEP 3 — PASSWORD */}
                                    <Show show={ step === Register.Step.PASSWORD }>
                                        <PasswordInput id="register-password" label={"Password"} value={ password } autoComplete="new-password" onChange={ setPassword } />
                                        <PasswordInput id="register-confirm" label={"Confirm password"} value={ confirm } autoComplete="verify-password" onChange={ setConfirm } />

                                        <Button type="submit" variant="contained" fullWidth disabled={ !passwordStepValid }>Continue</Button>
                                    </Show>

                                    {/* STEP 4 — BOT verification (stub) */}
                                    <Show show={ step === Register.Step.BOT }>
                                        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, py: 2 }}>
                                            <SmartToyOutlinedIcon fontSize="large" color="action" />
                                            <TextLabel align="center" value={"Confirm you're a human to continue. (Bot verification will appear here.)"} />
                                        </Box>
                                        <Button type="submit" variant="contained" fullWidth>{"Continue"}</Button>
                                    </Show>

                                    {/* STEP 5 — VERIFY the contact method */}
                                    <Show show={ step === Register.Step.VERIFY }>
                                        <TextLabel align="center"
                                                value={ ( method === Register.Method.EMAIL ? "We emailed a code to " : "We texted a code to " ) + identifierDisplay } />
                                        <TextInput id="register-code"
                                                    label={"Verification code"}
                                                    value={ code }
                                                    allNumeric
                                                    maxLength={ Register.CODE_LENGTH }
                                                    align="center"
                                                    onChange={ setCode } />
                                        <Button type="submit" variant="contained" fullWidth disabled={ !codeValid || submitting }>{ submitting ? "Verifying…" : "Verify" }</Button>
                                        <LinkButton label={"Resend code"} onClick={ onResend } sx={{ width: "auto", alignSelf: "center" }} />
                                    </Show>

                                    {/* STEP 6 — TERMS: review + accept, then create the account (stub) */}
                                    <Show show={ step === Register.Step.TERMS }>
                                        {/* must be scrolled to the bottom before "I agree" unlocks */}
                                        <TextLabel value="Please review the Terms of Service:" />
                                        <LegalScroll id="register-tos" src={ Register.TERMS_URL } onReachedEnd={ () => setTosRead( true ) } />

                                        <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", justifyContent: "space-between" }}>
                                            <CheckboxInput id="register-agree"
                                                        allowWrap
                                                        disabled={ !tosRead }
                                                        value={ agreed }
                                                        label={"I have read and agree to the Terms and Conditions"}
                                                        onChange={ setAgreed } />
                                            <ButtonIcon id="register-tos-download"
                                                        size="small"
                                                        disabled={ downloadingTos }
                                                        icon={ <DownloadOutlinedIcon fontSize="small" /> }
                                                        label={ downloadingTos ? "Preparing PDF…" : "Download PDF" }
                                                        onClick={ () => { void onDownloadTos(); } } />
                                        </Stack>
                                        <Show show={ !tosRead }>
                                            <TextLabel value={"Scroll to the bottom of the Terms of Service to continue."} />
                                        </Show>

                                        <Button type="submit" variant="contained" fullWidth disabled={ !termsValid || submitting }>{ submitting ? "Creating account…" : "Agree & Create Account" }</Button>
                                    </Show>

                                    {/* STEP 7 — SUCCESS: account created + verified → invite them to sign in */}
                                    <Show show={ step === Register.Step.SUCCESS }>
                                        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1.5, py: 2 }}>
                                            <CheckCircleOutlineOutlinedIcon color="success" sx={{ fontSize: 64 }} />
                                            <TextLabel variant="h6" align="center" value={"Registration successful!"} />
                                            <TextLabel align="center" color="secondary"
                                                    value={"Your account is ready. You can now sign in" + ( identifier ? " with " + identifierDisplay + "." : "." )} />
                                        </Box>
                                        <Button type="button" variant="contained" fullWidth onClick={ onComplete }>Sign In</Button>
                                    </Show>

                                </Stack>
                            </Box>

                            <ErrorMessage value={ error } />

                            {/* already have an account? (hidden on the success step — it has its own Sign In) */}
                            <Show show={ step !== Register.Step.SUCCESS }>
                                <Divider />
                                <Stack direction="row" spacing={ 1 } sx={{ justifyContent: "center", alignItems: "center" }}>
                                    <TextLabel value="Already have an account?" />
                                    <LinkButton label="Sign In" onClick={ () => appmodel.goto( AppRouter.Route.LOGIN ) } sx={{ width: "auto" }} />
                                </Stack>
                            </Show>

                        </Stack>
                    </Paper>
                </Box>
            </Page>;
}

export namespace Register
{
    // minimum chars for a sign-up password (client-side floor; auth re-enforces the real policy)
    export const MIN_PASSWORD : number = 8;
    // length of the emailed/texted verification code
    export const CODE_LENGTH  : number = 6;
    // the Terms of Service document (rendered in the scroll viewer + offered as a PDF download)
    export const TERMS_URL    : string = "/legal/terms.html";

    // the wizard advances one view at a time
    export enum Step
    {
        IDENTIFIER = "identifier",   // email/phone (or SSO) → existence check
        PROFILE    = "profile",      // first/last name + account name (new account)
        PASSWORD   = "password",     // password + confirm
        BOT        = "bot",          // anti-bot verification (stub)
        TERMS      = "terms",        // review + accept ToS → create the account (POST /register)
        VERIFY     = "verify",       // emailed/texted code (POST /register/verify)
        SUCCESS    = "success",      // account created + verified → sign-in CTA
    }

    export enum Method
    {
        EMAIL = "email",
        PHONE = "phone",
    }

    // social / consumer SSO providers (enterprise SAML/OIDC handled separately)
    export enum SsoProvider
    {
        GOOGLE    = "google",
        MICROSOFT = "microsoft",
        APPLE     = "apple",
    }

    export interface Props
    {
    }
}

export default Register;

// eof
