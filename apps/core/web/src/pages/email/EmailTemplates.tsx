import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Button, Card, CardContent, CardHeader, Chip, CircularProgress, Divider, Drawer, Stack, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import AddOutlinedIcon           from '@mui/icons-material/AddOutlined';
import RefreshOutlinedIcon       from '@mui/icons-material/RefreshOutlined';
import EditOutlinedIcon          from '@mui/icons-material/EditOutlined';
import ArchiveOutlinedIcon       from '@mui/icons-material/ArchiveOutlined';
import ContentCopyOutlinedIcon   from '@mui/icons-material/ContentCopyOutlined';
import VisibilityOutlinedIcon    from '@mui/icons-material/VisibilityOutlined';
import CloseOutlinedIcon         from '@mui/icons-material/CloseOutlined';
import DesktopWindowsOutlinedIcon from '@mui/icons-material/DesktopWindowsOutlined';
import PhoneIphoneOutlinedIcon   from '@mui/icons-material/PhoneIphoneOutlined';

import { Access } from '@repo/system';
import { EmailTemplate, Email, GetEmailTemplates, GetEmailTemplate, PostEmailTemplate, DeleteEmailTemplate, PostEmailTemplatePreview } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import AuthPage    from '@widgets/app/AuthPage';
import ButtonIcon  from '@widgets/core/ButtonIcon';
import TableInput  from '@widgets/core/TableInput';
import SnackAlert  from '@widgets/core/SnackAlert';
import EmailTemplateEditor from '@widgets/email/EmailTemplateEditor';
import NewEmailTemplateDialog from '@pages/email/dialogs/NewEmailTemplateDialog';

// sample merge data so the list preview shows real values for the standard tokens
const SAMPLE_MERGE : Record<string, unknown> =
{
    name: { first: "Jane", last: "Doe", full: "Jane Doe" },
    email: "jane@example.com",
    address: { street1: "123 Main St", city: "Austin", state: "TX", zip: "78701" },
    account: { name: "Acme Co", address: "500 Congress Ave, Austin TX" },
    campaign: { name: "Spring Sale" },
    unsubscribe_url: "#",
    mfa_code : "012345"
};

// TableInput row-action ids
enum TplAction { OPEN = "open", PREVIEW = "preview", DUPLICATE = "duplicate", ARCHIVE = "archive" }

//
// Email Templates — the template library (mounted under Media → Studio). Lists the account's + system
// templates; create a new one (name/scope/case) and design it in the self-contained EmailTemplateEditor
// (managed mode). Archive retired ones. The editor is the same component campaign editing + Settings → Email
// reuse.
//
export function EmailTemplates( props : EmailTemplates.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [templates,setTemplates] = React.useState< Array<EmailTemplate.Entity> >( [] );
    const [loading,setLoading]     = React.useState< boolean >( true );
    const [editingId,setEditingId] = React.useState< string | null >( null );   // open editor for this template
    const [newScope,setNewScope]   = React.useState< EmailTemplate.Scope | null >( null );   // new-template dialog (null closed); the scope it creates
    const isAppAdmin : boolean = Access.isAllowed( appmodel.auth.role(), Access.AppRole.APPLICATION );
    const [snack,setSnack]         = React.useState< { message : string; severity : SnackAlert.Severity } | null >( null );
    const [preview,setPreview]     = React.useState< Email.PreviewViewport | null >( null );   // preview drawer viewport
    const [previewHtml,setPreviewHtml] = React.useState< string >( "" );

    React.useEffect( componentLoaded, [] );
    
    ////////////////////////////////////////////////////////////////////////////////////////////
    // on mount: load the templates + honor a `?open=<id>` deep-link (e.g. from Studio's create)
    function componentLoaded() : void
    {
        void load();
        const open : string | null = new URLSearchParams( window.location.search ).get( "open" );
        if( open ) setEditingId( open );
    }
    
    ////////////////////////////////////////////////////////////////////////////////////////////
    async function load() : Promise<void>
    {
        setLoading( true );
        const reply : RestfulService.Reply<GetEmailTemplates.Response> = await appmodel.server.fetch( new GetEmailTemplates() );
        if( reply.ok && reply.data ) setTemplates( reply.data.records );
        setLoading( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // create a draft (from the dialog) + open it in the editor
    async function onCreate( name : string, scope : EmailTemplate.Scope, notificationType? : EmailTemplate.NotificationType ) : Promise<boolean>
    {
        const reply : RestfulService.Reply<PostEmailTemplate.Response> = await appmodel.server.fetch(
            new PostEmailTemplate( { name, scope, notificationType, subject: "", doc: EmailTemplate.DEFAULT_DOC } ) );
        if( reply.ok && reply.data )
        {
            setNewScope( null );
            setEditingId( reply.data.id );
            void load();
            return true;
        }
        setSnack( { message: "Could not create the template.", severity: "error" } );
        return false;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // archive a template
    async function onArchive( id : string ) : Promise<void>
    {
        const reply : RestfulService.Reply<DeleteEmailTemplate.Response> = await appmodel.server.fetch( new DeleteEmailTemplate( id ) );
        if( reply.ok )
        {
            setSnack( { message: "Template archived.", severity: "success" } );
            void load();
        }
        else
            setSnack( { message: "Could not archive (a published template can't be archived).", severity: "error" } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // preview a template's compiled HTML (merged with sample data) in the drawer — no editing
    async function openPreview( id : string ) : Promise<void>
    {
        const reply : RestfulService.Reply<PostEmailTemplatePreview.Response> = await appmodel.server.fetch( new PostEmailTemplatePreview( id, { mergeData: SAMPLE_MERGE } ) );
        if( reply.ok && reply.data )
        {
            setPreviewHtml( reply.data.html );
            setPreview( Email.PreviewViewport.DESKTOP );
        }
        else
            setSnack( { message: "Could not render the preview.", severity: "error" } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // duplicate a template → a new DRAFT copy ("Copy of …") with the same doc/subject, opened in the editor
    async function onDuplicate( id : string ) : Promise<void>
    {
        // fetch the full source (the list rows don't carry the block doc)
        const source : RestfulService.Reply<GetEmailTemplate.Response> = await appmodel.server.fetch( new GetEmailTemplate( id ) );
        if( !source.ok || !source.data ) { setSnack( { message: "Could not load the template to duplicate.", severity: "error" } ); return; }
        const original : EmailTemplate.Entity = source.data.template;
        // create the copy as a DRAFT — carry the event + campaign so it's a real alternate for the same case
        // (a case can have many templates, only one published; publishing the copy demotes the current one)
        const created : RestfulService.Reply<PostEmailTemplate.Response> = await appmodel.server.fetch(
            new PostEmailTemplate( { name: `Copy of ${ original.name }`, scope: original.scope, campaignId: original.campaignId, notificationType: original.notificationType, subject: original.subject, doc: original.doc } ) );
        if( created.ok && created.data )
        {
            setSnack( { message: "Template duplicated.", severity: "success" } );
            setEditingId( created.data.id );
            void load();
        }
        else
            setSnack( { message: "Could not duplicate the template.", severity: "error" } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a row action → open the editor, preview, duplicate, or archive
    function onAction( action : string, row : TableInput.Row ) : void
    {
        switch( action )
        {
            case TplAction.OPEN     : setEditingId( row.id ); break;
            case TplAction.PREVIEW  : void openPreview( row.id ); break;
            case TplAction.DUPLICATE: void onDuplicate( row.id ); break;
            case TplAction.ARCHIVE  : void onArchive( row.id ); break;
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // status cell — draft (default) / published (green) / archived (muted)
    function statusRenderer( _col : TableInput.Column, row : TableInput.Row ) : JSX.Element
    {
        const published : boolean = row.status === EmailTemplate.Status.PUBLISHED;
        const archived : boolean = row.status === EmailTemplate.Status.ARCHIVED;
        return <Chip size="small" variant="outlined" color={ published ? "success" : archived ? "default" : "info" } label={ String( row.status ) } />;
    }

    // ACCOUNT templates — the "scope" column is replaced by "Campaign" (a template can optionally belong to one)
    const accountColumns : Array<TableInput.Column> =
    [
        { field: "name",             label: "Name",     type: TableInput.ColumnType.STRING },
        { field: "campaign",         label: "Campaign", type: TableInput.ColumnType.STRING },
        { field: "notificationType", label: "Case",     type: TableInput.ColumnType.STRING },
        { field: "status",           label: "Status",   type: TableInput.ColumnType.CUSTOM, renderer: statusRenderer },
        { field: "actions",          label: "",         type: TableInput.ColumnType.ACTION },
    ];
    // APPLICATION templates — bound to an EVENT (notification case) instead of a campaign
    const appColumns : Array<TableInput.Column> =
    [
        { field: "name",             label: "Name",   type: TableInput.ColumnType.STRING },
        { field: "notificationType", label: "Event",  type: TableInput.ColumnType.STRING },
        { field: "status",           label: "Status", type: TableInput.ColumnType.CUSTOM, renderer: statusRenderer },
        { field: "actions",          label: "",       type: TableInput.ColumnType.ACTION },
    ];
    const actions : Array<TableInput.Action> =
    [
        { id: TplAction.OPEN,      label: "Open",      icon: <EditOutlinedIcon fontSize="small" /> },
        { id: TplAction.PREVIEW,   label: "Preview",   icon: <VisibilityOutlinedIcon fontSize="small" /> },
        { id: TplAction.DUPLICATE, label: "Duplicate", icon: <ContentCopyOutlinedIcon fontSize="small" /> },
        { id: TplAction.ARCHIVE,   label: "Archive",   icon: <ArchiveOutlinedIcon fontSize="small" /> },
    ];

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the row actions available for a template (a published one can't be archived)
    function rowActions( template : EmailTemplate.Entity ) : Array<string>
    {
        return template.status === EmailTemplate.Status.PUBLISHED
            ? [ TplAction.OPEN, TplAction.PREVIEW, TplAction.DUPLICATE ]
            : [ TplAction.OPEN, TplAction.PREVIEW, TplAction.DUPLICATE, TplAction.ARCHIVE ];
    }
    // partition the templates by scope — account templates vs the platform (application) set
    const accountRows : Array<TableInput.Row> = templates
        .filter( ( template : EmailTemplate.Entity ) : boolean => template.scope === EmailTemplate.Scope.ACCOUNT )
        .map( ( template : EmailTemplate.Entity ) : TableInput.Row => ( {
            id: template.id, name: template.name, campaign: template.campaignId ?? "—",
            notificationType: template.notificationType ?? "—", status: template.status, actions: rowActions( template ),
        } ) );
    const appRows : Array<TableInput.Row> = templates
        .filter( ( template : EmailTemplate.Entity ) : boolean => template.scope === EmailTemplate.Scope.SYSTEM )
        .map( ( template : EmailTemplate.Entity ) : TableInput.Row => ( {
            id: template.id, name: template.name,
            notificationType: template.notificationType ?? "(unassigned)", status: template.status, actions: rowActions( template ),
        } ) );

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <AuthPage minAccess={ undefined } title={"Email Templates"}>

                { editingId
                    ? <Box sx={{ height: "calc(100vh - 130px)" }}>
                          <EmailTemplateEditor templateId={ editingId }
                                               onSaved={ () => void load() }
                                               onDuplicate={ () => { if( editingId ) void onDuplicate( editingId ); } }
                                               onClose={ () => { setEditingId( null ); void load(); } } />
                      </Box>
                    : <Box sx={{ p: 2 }}>
                        <Stack spacing={ 2 }>

                          {/* ── Account templates (optionally campaign-scoped) ─────────────────── */}
                          <Card variant="outlined">
                              <CardHeader title={"Email Templates"}
                                          subheader={"Design reusable account email templates (optionally tied to a campaign)."}
                                          action={
                                              <Stack direction="row" spacing={ 1 } sx={{ mt: 1, mr: 1 }}>
                                                  <ButtonIcon id="tpl-refresh" label={"Refresh"} icon={ <RefreshOutlinedIcon fontSize="small" /> } onClick={ () => void load() } />
                                                  <Button size="small" variant="contained" startIcon={ <AddOutlinedIcon /> } onClick={ () => setNewScope( EmailTemplate.Scope.ACCOUNT ) }>{"New template"}</Button>
                                              </Stack>
                                          } />
                              <Divider />
                              <CardContent>
                                  { loading
                                      ? <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}><CircularProgress size={ 18 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading…"}</Typography></Stack>
                                      : accountRows.length === 0
                                          ? <Typography variant="body2" sx={{ color: "text.secondary" }}>{"No templates yet. Create one to get started."}</Typography>
                                          : <TableInput id="email-templates" columns={ accountColumns } data={ accountRows } actions={ actions } onAction={ onAction } selectable={ TableInput.Selectable.NONE } /> }
                              </CardContent>
                          </Card>

                          {/* ── Application (platform) templates — app/root staff only ─────────── */}
                          { isAppAdmin &&
                            <Card variant="outlined">
                                <CardHeader title={"Application Email Templates"}
                                            subheader={"Platform-wide templates assigned to system events. An account can override one for its own users (white-label)."}
                                            action={
                                                <Stack direction="row" spacing={ 1 } sx={{ mt: 1, mr: 1 }}>
                                                    <ButtonIcon id="tpl-app-refresh" label={"Refresh"} icon={ <RefreshOutlinedIcon fontSize="small" /> } onClick={ () => void load() } />
                                                    <Button size="small" variant="contained" startIcon={ <AddOutlinedIcon /> } onClick={ () => setNewScope( EmailTemplate.Scope.SYSTEM ) }>{"New application template"}</Button>
                                                </Stack>
                                            } />
                                <Divider />
                                <CardContent>
                                    { loading
                                        ? <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}><CircularProgress size={ 18 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading…"}</Typography></Stack>
                                        : appRows.length === 0
                                            ? <Typography variant="body2" sx={{ color: "text.secondary" }}>{"No application templates yet."}</Typography>
                                            : <TableInput id="email-app-templates" columns={ appColumns } data={ appRows } actions={ actions } onAction={ onAction } selectable={ TableInput.Selectable.NONE } /> }
                                </CardContent>
                            </Card> }

                        </Stack>
                      </Box> }

                { newScope !== null && <NewEmailTemplateDialog fixedScope={ newScope } onCreate={ onCreate } onClose={ () => setNewScope( null ) } /> }

                {/* preview drawer — the compiled HTML body, desktop / mobile viewport */}
                <Drawer anchor="right" open={ preview !== null } onClose={ () => setPreview( null ) }>
                    <Box sx={{ width: preview === Email.PreviewViewport.MOBILE ? 420 : 760, maxWidth: "100vw", height: "100%", display: "flex", flexDirection: "column", transition: "width 0.2s" }}>
                        <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", px: 2, py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
                            <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>{"Preview"}</Typography>
                            <ToggleButtonGroup size="small" exclusive value={ preview } onChange={ ( _event : React.MouseEvent, value : Email.PreviewViewport | null ) => { if( value ) setPreview( value ); } }>
                                <ToggleButton value={ Email.PreviewViewport.DESKTOP }><DesktopWindowsOutlinedIcon fontSize="small" /></ToggleButton>
                                <ToggleButton value={ Email.PreviewViewport.MOBILE }><PhoneIphoneOutlinedIcon fontSize="small" /></ToggleButton>
                            </ToggleButtonGroup>
                            <ButtonIcon id="tpl-list-preview-close" label={"Close"} size="small" icon={ <CloseOutlinedIcon fontSize="small" /> } onClick={ () => setPreview( null ) } />
                        </Stack>
                        <Box sx={{ flexGrow: 1, minHeight: 0, overflow: "auto", display: "flex", justifyContent: "center", p: 2, bgcolor: "action.hover" }}>
                            <Box component="iframe" title="template-preview" sandbox="" srcDoc={ previewHtml }
                                 sx={{ width: preview === Email.PreviewViewport.MOBILE ? 380 : 680, height: "100%", border: 1, borderColor: "divider", borderRadius: 1, bgcolor: "#fff" }} />
                        </Box>
                    </Box>
                </Drawer>

                { snack && <SnackAlert message={ snack.message } severity={ snack.severity } onClose={ () => setSnack( null ) } /> }
            </AuthPage>;
}

export namespace EmailTemplates
{
    export interface Props
    {
    }
}

export default EmailTemplates;
// eof
