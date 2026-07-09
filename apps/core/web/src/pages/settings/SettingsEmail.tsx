import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Button, Card, CardContent, CardHeader, CircularProgress, Divider, Stack, Typography } from "@mui/material";
import AddOutlinedIcon           from '@mui/icons-material/AddOutlined';
import RefreshOutlinedIcon       from '@mui/icons-material/RefreshOutlined';
import EditOutlinedIcon          from '@mui/icons-material/EditOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';

import { Access } from '@repo/system';
import { Email, EmailConfig, EmailTemplate, GetEmailConfig, PutEmailConfig, GetEmailTemplates, PostEmailTemplatePublish } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import AuthPage     from '@widgets/app/AuthPage';
import ButtonIcon   from '@widgets/core/ButtonIcon';
import SaveBar      from '@widgets/app/SaveBar';
import SnackAlert   from '@widgets/core/SnackAlert';
import SelectInput  from '@widgets/core/SelectInput';
import SwitchInput  from '@widgets/core/SwitchInput';
import TextInput    from '@widgets/core/TextInput';
import TableInput   from '@widgets/core/TableInput';
import WebFontListEditor from '@widgets/email/WebFontListEditor';
import SystemSenderDialog from '@pages/settings/dialogs/SystemSenderDialog';

// TableInput row-action ids
enum SenderAction { EDIT = "edit", REMOVE = "remove" }

// the SYSTEM notification cases whose from-identity can be routed to a specific sender (system mail only)
const SYSTEM_CASES : Array<Email.NotificationType> =
[
    Email.NotificationType.PASSWORD_RESET,
    Email.NotificationType.EMAIL_VERIFICATION,
    Email.NotificationType.MFA_CODE,
    Email.NotificationType.ACCOUNT_INVITE,
    Email.NotificationType.WELCOME,
    Email.NotificationType.SECURITY_ALERT,
];

//
// Settings : Email — the platform (app/root) email admin. Sets the ACCOUNT + SYSTEM providers, the outbound
// SYSTEM sender identities (per need) + per-notification routing, send limits, scheduling policy, and the
// marketplace toggle. Reads/writes the email service config (GetEmailConfig / PutEmailConfig, ROOT-gated).
//
export function SettingsEmail( props : SettingsEmail.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    // application + root staff manage the platform email config + system templates
    const editable : boolean = Access.isAllowed( appmodel.auth.role(), Access.AppRole.APPLICATION );

    const [form,setForm]         = React.useState< EmailConfig.Config | null >( null );
    const [original,setOriginal] = React.useState< string >( "" );
    const [loading,setLoading]   = React.useState< boolean >( true );
    const [saveError,setSaveError] = React.useState< string >( "" );
    const [snack,setSnack]       = React.useState< { message : string; severity : SnackAlert.Severity } | null >( null );
    const [sender,setSender]     = React.useState< { editing? : Email.Sender } | null >( null );   // sender dialog (null closed)
    const [sysTemplates,setSysTemplates] = React.useState< Array<EmailTemplate.Entity> >( [] );   // SYSTEM-scope templates

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( componentLoaded, [] );

    // on mount: load the config + the SYSTEM templates (staff only)
    function componentLoaded() : void
    {
        if( editable ) { void load(); void loadTemplates(); }
        else setLoading( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // load the email service config
    async function load() : Promise<void>
    {
        setLoading( true );
        const reply : RestfulService.Reply<GetEmailConfig.Response> = await appmodel.server.fetch( new GetEmailConfig() );
        if( reply.ok && reply.data ) { setForm( reply.data.config ); setOriginal( JSON.stringify( reply.data.config ) ); }
        setLoading( false );
    }

    // load the SYSTEM-scope templates (used to pick which one serves each system case)
    async function loadTemplates() : Promise<void>
    {
        const reply : RestfulService.Reply<GetEmailTemplates.Response> = await appmodel.server.fetch( new GetEmailTemplates( { scope: EmailTemplate.Scope.SYSTEM } ) );
        if( reply.ok && reply.data ) setSysTemplates( reply.data.records );
    }

    // publish (activate) the chosen SYSTEM template for a case — it becomes the one used for that notification
    async function selectCaseTemplate( templateId : string ) : Promise<void>
    {
        if( templateId === "" ) return;
        const reply : RestfulService.Reply<PostEmailTemplatePublish.Response> = await appmodel.server.fetch( new PostEmailTemplatePublish( templateId ) );
        if( reply.ok ) { setSnack( { message: "System template activated.", severity: "success" } ); void loadTemplates(); }
        else setSnack( { message: "Could not activate the template.", severity: "error" } );
    }

    // the PUBLISHED SYSTEM templates that target a given case — only a published (live) template is selectable
    // here; author + publish a draft in the editor first to make it eligible.
    function caseTemplates( notification : Email.NotificationType ) : Array<EmailTemplate.Entity>
    {
        return sysTemplates.filter( ( template : EmailTemplate.Entity ) : boolean => template.notificationType === notification && template.status === EmailTemplate.Status.PUBLISHED );
    }
    // the id of the currently-ACTIVE (published) template for a case (or "" when none is active)
    function activeCaseTemplateId( notification : Email.NotificationType ) : string
    {
        const active : EmailTemplate.Entity | undefined = caseTemplates( notification ).find( ( template : EmailTemplate.Entity ) : boolean => template.status === EmailTemplate.Status.PUBLISHED );
        return active?.id ?? "";
    }
    // the case's template choices for the dropdown (leading "none" + each candidate labelled with its status)
    function caseTemplateChoices( notification : Email.NotificationType ) : Array<SelectInput.Choice>
    {
        return [ { value: "", label: "(none — pick a published template)" }, ...caseTemplates( notification ).map( ( template : EmailTemplate.Entity ) : SelectInput.Choice => ( { value: template.id, label: template.name } ) ) ];
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // persist the edited config
    async function onSave() : Promise<boolean>
    {
        if( !form ) return false;
        setSaveError( "" );
        const reply : RestfulService.Reply<PutEmailConfig.Response> = await appmodel.server.fetch( new PutEmailConfig( { config: form } ) );
        if( reply.ok && reply.data ) { setForm( reply.data.config ); setOriginal( JSON.stringify( reply.data.config ) ); return true; }
        setSaveError( "Could not save the email config. Check the values and try again." );
        return false;
    }

    // revert edits to the last-loaded config
    function onReset() : void { if( original ) setForm( JSON.parse( original ) as EmailConfig.Config ); }

    const dirty : boolean = form !== null && JSON.stringify( form ) !== original;

    ////////////////////////////////////////////////////////////////////////////////////////////
    // shallow-merge a patch into the config
    function set( patch : Partial<EmailConfig.Config> ) : void { setForm( ( prev ) => ( prev ? { ...prev, ...patch } : prev ) ); }

    // parse a numeric field (blank/NaN → 0)
    function num( value : string ) : number { const parsed : number = parseInt( value, 10 ); return Number.isFinite( parsed ) ? parsed : 0; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // upsert a sender (replace-in-place on edit, append on add)
    function upsertSender( entry : Email.Sender ) : void
    {
        if( !form ) return;
        const exists : boolean = form.systemSenders.some( ( item : Email.Sender ) : boolean => item.key === entry.key );
        const next : Array<Email.Sender> = exists
            ? form.systemSenders.map( ( item : Email.Sender ) : Email.Sender => ( item.key === entry.key ? entry : item ) )
            : [ ...form.systemSenders, entry ];
        set( { systemSenders: next } );
    }

    // remove a sender + clean up any references (default key / routing) to it
    function removeSender( key : string ) : void
    {
        if( !form ) return;
        const next : Array<Email.Sender> = form.systemSenders.filter( ( item : Email.Sender ) : boolean => item.key !== key );
        const routing : Partial<Record<Email.NotificationType, string>> = {};
        for( const notification of SYSTEM_CASES )
        {
            const routed : string | undefined = form.systemSenderRouting[ notification ];
            if( routed !== undefined && routed !== key ) routing[ notification ] = routed;
        }
        const defaultKey : string = form.defaultSystemSenderKey === key ? ( next[ 0 ]?.key ?? "" ) : form.defaultSystemSenderKey;
        set( { systemSenders: next, systemSenderRouting: routing, defaultSystemSenderKey: defaultKey } );
    }

    // set (or clear, when "") the routed sender for a notification case
    function setRoute( notification : Email.NotificationType, key : string ) : void
    {
        if( !form ) return;
        const routing : Partial<Record<Email.NotificationType, string>> = { ...form.systemSenderRouting };
        if( key === "" ) delete routing[ notification ]; else routing[ notification ] = key;
        set( { systemSenderRouting: routing } );
    }

    // a sender row action → edit (open the dialog) or remove
    function onSenderAction( action : string, row : TableInput.Row ) : void
    {
        if( !form ) return;
        const entry : Email.Sender | undefined = form.systemSenders.find( ( item : Email.Sender ) : boolean => item.key === row.id );
        if( !entry ) return;
        if( action === SenderAction.EDIT ) setSender( { editing: entry } );
        else if( action === SenderAction.REMOVE ) removeSender( entry.key );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // provider + sender-key choices
    const providerChoices : Array<SelectInput.Choice> = SelectInput.enumToChoices( Email.Provider );
    const senderChoices : Array<SelectInput.Choice> = ( form?.systemSenders ?? [] )
        .map( ( item : Email.Sender ) : SelectInput.Choice => ( { value: item.key, label: item.purpose ? `${ item.key } — ${ item.purpose }` : item.key } ) );
    const routeChoices : Array<SelectInput.Choice> = [ { value: "", label: "(default sender)" }, ...senderChoices ];

    const senderColumns : Array<TableInput.Column> =
    [
        { field: "key",     label: "Key",     type: TableInput.ColumnType.STRING },
        { field: "email",   label: "Address", type: TableInput.ColumnType.EMAIL },
        { field: "name",    label: "Name",    type: TableInput.ColumnType.STRING },
        { field: "purpose", label: "Purpose", type: TableInput.ColumnType.STRING },
        { field: "actions", label: "",        type: TableInput.ColumnType.ACTION },
    ];
    const senderActions : Array<TableInput.Action> =
    [
        { id: SenderAction.EDIT,   label: "Edit",   icon: <EditOutlinedIcon fontSize="small" /> },
        { id: SenderAction.REMOVE, label: "Remove", icon: <DeleteOutlineOutlinedIcon fontSize="small" /> },
    ];
    const senderRows : Array<TableInput.Row> = ( form?.systemSenders ?? [] ).map( ( item : Email.Sender ) : TableInput.Row => ( {
        id: item.key, key: item.key, email: item.email, name: item.name, purpose: item.purpose ?? "",
        actions: [ SenderAction.EDIT, SenderAction.REMOVE ],
    } ) );

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <AuthPage minAccess={ Access.AppRole.APPLICATION } title={"Settings : Email"}>
                <Box sx={{ p: 2, mx: "auto", pb: editable ? 12 : 2 }}>

                    { !editable &&
                        <Typography variant="body2" sx={{ color: "text.secondary", p: 2 }}>{"Only application/root staff can manage the platform email config."}</Typography> }

                    { editable && loading &&
                        <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", p: 2 }}><CircularProgress size={ 18 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading…"}</Typography></Stack> }

                    { editable && !loading && form &&
                        <Stack spacing={ 2 }>

                            {/* ── Providers ─────────────────────────────────────────────────────── */}
                            <Card variant="outlined">
                                <CardHeader title={"Providers"} subheader={"Which provider sends account mail vs platform/system mail (reset, verification). Only providers with an adapter can be saved."} />
                                <Divider />
                                <CardContent>
                                    <Stack spacing={ 2 }>
                                        <SelectInput id="email-default-provider" label={"Default provider (account sends)"} value={ form.defaultProvider }
                                                     choices={ providerChoices } onChange={ ( value : string ) : void => set( { defaultProvider: value as Email.Provider } ) } sx={{ width: "100%" }} />
                                        <SelectInput id="email-system-provider" label={"System provider (platform mail)"} value={ form.systemProvider }
                                                     choices={ providerChoices } onChange={ ( value : string ) : void => set( { systemProvider: value as Email.Provider } ) } sx={{ width: "100%" }} />
                                    </Stack>
                                </CardContent>
                            </Card>

                            {/* ── System templates (which template serves each system notification) ─ */}
                            <Card variant="outlined">
                                <CardHeader title={"System templates"}
                                            subheader={"Pick which platform template each system notification uses (password reset, welcome, verification, …). Only PUBLISHED templates are selectable — publish a draft in the editor to make it eligible." } />
                                <Divider />
                                <CardContent>
                                    <Stack spacing={ 2 }>
                                        { SYSTEM_CASES.map( ( notification : Email.NotificationType ) : JSX.Element => (
                                            <SelectInput key={ notification } id={ `sys-tpl-${ notification }` } label={ notification }
                                                         value={ activeCaseTemplateId( notification ) }
                                                         choices={ caseTemplateChoices( notification ) }
                                                         onChange={ ( value : string ) : void => void selectCaseTemplate( value ) } sx={{ width: "100%" }} /> ) ) }
                                        <Typography variant="caption" sx={{ color: "text.secondary" }}>{"Author system templates in Media → Studio → Email Templates (scope: System). Only PUBLISHED templates targeting a case appear here."}</Typography>
                                    </Stack>
                                </CardContent>
                            </Card>

                            {/* ── System senders + routing ──────────────────────────────────────── */}
                            <Card variant="outlined">
                                <CardHeader title={"System senders"}
                                            subheader={"The platform's outbound from-identities for different needs, and which one each system notification uses."}
                                            action={
                                                <Stack direction="row" spacing={ 1 } sx={{ mt: 1, mr: 1 }}>
                                                    <Button variant="contained" size="small" startIcon={ <AddOutlinedIcon /> } onClick={ () => setSender( {} ) }>{"Add sender"}</Button>
                                                </Stack>
                                            } />
                                <Divider />
                                <CardContent>
                                    <Stack spacing={ 2 }>
                                        { form.systemSenders.length === 0
                                            ? <Typography variant="body2" sx={{ color: "text.secondary" }}>{"No senders yet. Add one (e.g. no-reply)."}</Typography>
                                            : <TableInput id="email-system-senders" columns={ senderColumns } data={ senderRows } actions={ senderActions } onAction={ onSenderAction } selectable={ TableInput.Selectable.NONE } /> }

                                        <SelectInput id="email-default-sender" label={"Default sender"} value={ form.defaultSystemSenderKey }
                                                     choices={ senderChoices } onChange={ ( value : string ) : void => set( { defaultSystemSenderKey: value } ) } sx={{ width: "100%" }} />

                                        <Typography variant="subtitle2" sx={{ mt: 1 }}>{"Routing"}</Typography>
                                        <Typography variant="caption" sx={{ color: "text.secondary" }}>{"Pick the sender for each system notification (else the default is used)."}</Typography>
                                        { SYSTEM_CASES.map( ( notification : Email.NotificationType ) : JSX.Element => (
                                            <SelectInput key={ notification } id={ `email-route-${ notification }` } label={ notification }
                                                         value={ form.systemSenderRouting[ notification ] ?? "" }
                                                         choices={ routeChoices }
                                                         onChange={ ( value : string ) : void => setRoute( notification, value ) } sx={{ width: "100%" }} />
                                        ) ) }
                                    </Stack>
                                </CardContent>
                            </Card>

                            {/* ── Web fonts (platform/app-level library) ────────────────────────── */}
                            <Card variant="outlined">
                                <CardHeader title={"Web fonts (platform)"} subheader={"The app-level web-font library available to every account's templates. Add + drag to set priority order."} />
                                <Divider />
                                <CardContent>
                                    <WebFontListEditor fonts={ form.webFonts ?? [] } onChange={ ( next : Array<{ name : string; href : string }> ) : void => set( { webFonts: next } ) } />
                                </CardContent>
                            </Card>

                            {/* ── Limits + scheduling ───────────────────────────────────────────── */}
                            <Card variant="outlined">
                                <CardHeader title={"Limits & scheduling"} subheader={"Per-account send caps + the scheduled-send safe buffer and timezone."} />
                                <Divider />
                                <CardContent>
                                    <Stack spacing={ 2 }>
                                        <TextInput id="email-limit-day" label={"Max per account / day"} value={ String( form.limits.perAccountPerDay ) } allNumeric fullWidth
                                                   onChange={ ( value : string ) : void => set( { limits: { ...form.limits, perAccountPerDay: num( value ) } } ) } />
                                        <TextInput id="email-limit-month" label={"Max per account / month"} value={ String( form.limits.perAccountPerMonth ) } allNumeric fullWidth
                                                   onChange={ ( value : string ) : void => set( { limits: { ...form.limits, perAccountPerMonth: num( value ) } } ) } />
                                        <TextInput id="email-limit-recipients" label={"Max recipients per send"} value={ String( form.limits.maxRecipientsPerSend ) } allNumeric fullWidth
                                                   onChange={ ( value : string ) : void => set( { limits: { ...form.limits, maxRecipientsPerSend: num( value ) } } ) } />
                                        <TextInput id="email-limit-rate" label={"Default rate (per minute)"} value={ String( form.limits.defaultRatePerMinute ) } allNumeric fullWidth
                                                   onChange={ ( value : string ) : void => set( { limits: { ...form.limits, defaultRatePerMinute: num( value ) } } ) } />
                                        <TextInput id="email-sched-buffer" label={"Safe buffer (minutes before a scheduled send)"} value={ String( form.scheduling.minLeadMinutes ) } allNumeric fullWidth
                                                   onChange={ ( value : string ) : void => set( { scheduling: { ...form.scheduling, minLeadMinutes: num( value ) } } ) } />
                                        <TextInput id="email-sched-maxlead" label={"Max lead (days a send can be scheduled out)"} value={ String( form.scheduling.maxLeadDays ) } allNumeric fullWidth
                                                   onChange={ ( value : string ) : void => set( { scheduling: { ...form.scheduling, maxLeadDays: num( value ) } } ) } />
                                        <TextInput id="email-sched-tz" label={"Default timezone"} value={ form.scheduling.defaultTimezone } fullWidth
                                                   onChange={ ( value : string ) : void => set( { scheduling: { ...form.scheduling, defaultTimezone: value } } ) } />
                                    </Stack>
                                </CardContent>
                            </Card>

                            {/* ── Marketplace ───────────────────────────────────────────────────── */}
                            <Card variant="outlined">
                                <CardHeader title={"Marketplace"} subheader={"Allow accounts to install their own marketplace email providers."} />
                                <Divider />
                                <CardContent>
                                    <SwitchInput id="email-marketplace" label={"Allow marketplace providers"} value={ form.marketplaceEnabled }
                                                 onChange={ ( value : boolean ) : void => set( { marketplaceEnabled: value } ) } />
                                </CardContent>
                            </Card>

                        </Stack>
                    }
                </Box>

                { editable && !loading && form &&
                    <SaveBar dirty={ dirty } error={ saveError } onReset={ onReset } onSave={ onSave } /> }

                { sender &&
                    <SystemSenderDialog sender={ sender.editing }
                                        existingKeys={ ( form?.systemSenders ?? [] ).map( ( item : Email.Sender ) : string => item.key ) }
                                        onSave={ ( entry : Email.Sender ) : void => { upsertSender( entry ); setSender( null ); } }
                                        onClose={ () => setSender( null ) } /> }

                { snack && <SnackAlert message={ snack.message } severity={ snack.severity } onClose={ () => setSnack( null ) } /> }
            </AuthPage>;
}

export namespace SettingsEmail
{
    export interface Props
    {
    }
}

export default SettingsEmail;
// eof
