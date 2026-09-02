import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Button, Card, CardContent, CardHeader, CircularProgress, Divider, Stack, Typography } from "@mui/material";
import AddOutlinedIcon        from '@mui/icons-material/AddOutlined';
import RefreshOutlinedIcon    from '@mui/icons-material/RefreshOutlined';
import EditOutlinedIcon       from '@mui/icons-material/EditOutlined';
import ArchiveOutlinedIcon    from '@mui/icons-material/ArchiveOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';

import { Print, GetPrintTemplates, PostPrintTemplates, PatchPrintTemplate, DeletePrintTemplate, PostPrintProof } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import AuthPage   from '@widgets/app/AuthPage';
import ButtonIcon from '@widgets/core/ButtonIcon';
import TableInput from '@widgets/core/TableInput';
import SnackAlert from '@widgets/core/SnackAlert';
import NewPrintTemplateDialog    from '@pages/print/dialogs/NewPrintTemplateDialog';
import PrintTemplateSchemaDialog from '@pages/print/dialogs/PrintTemplateSchemaDialog';

// TableInput row-action ids
enum TplAction { OPEN = "open", PREVIEW = "preview", ARCHIVE = "archive" }

//
// Print Templates — the direct-mail template library (mounted under Media → Studio). Lists the account's
// templates, creates new ones (name + physical type), edits their merge-field schema, previews a rendered
// proof PDF, and archives retired ones. The full SVG-canvas designer (print-2/3.3) is a documented follow-up —
// PrintTemplateSchemaDialog edits the merge fields as JSON today.
//
export function PrintTemplates( _props : PrintTemplates.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [templates,setTemplates] = React.useState< Array<Print.Template> >( [] );
    const [loading,setLoading]     = React.useState< boolean >( true );
    const [creating,setCreating]   = React.useState< boolean >( false );
    const [editing,setEditing]     = React.useState< Print.Template | null >( null );
    const [snack,setSnack]         = React.useState< { message : string; severity : SnackAlert.Severity } | null >( null );

    React.useEffect( componentLoaded, [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    function componentLoaded() : void { void load(); }

    async function load() : Promise<void>
    {
        setLoading( true );
        const reply : RestfulService.Reply<GetPrintTemplates.Response> = await appmodel.server.fetch( new GetPrintTemplates() );
        if( reply.ok && reply.data ) setTemplates( reply.data.templates );
        setLoading( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function onCreate( name : string, type : Print.MailpieceType ) : Promise<boolean>
    {
        const reply : RestfulService.Reply<PostPrintTemplates.Response> = await appmodel.server.fetch( new PostPrintTemplates( { name, type } ) );
        if( reply.ok && reply.data ) { setCreating( false ); void load(); return true; }
        setSnack( { message: "Could not create the template.", severity: "error" } );
        return false;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function onSaveSchema( id : string, name : string, schema : Record<string, unknown> ) : Promise<boolean>
    {
        const reply : RestfulService.Reply<PatchPrintTemplate.Response> = await appmodel.server.fetch( new PatchPrintTemplate( id, { name, schema } ) );
        if( reply.ok ) { setEditing( null ); void load(); return true; }
        setSnack( { message: "Could not save the template.", severity: "error" } );
        return false;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function onArchive( id : string ) : Promise<void>
    {
        const reply : RestfulService.Reply<DeletePrintTemplate.Response> = await appmodel.server.fetch( new DeletePrintTemplate( id ) );
        if( reply.ok ) { setSnack( { message: "Template archived.", severity: "success" } ); void load(); }
        else setSnack( { message: "Could not archive the template.", severity: "error" } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // render a proof PDF (sample merge data from the schema itself) and open it in a new tab
    async function onPreview( id : string ) : Promise<void>
    {
        const reply : RestfulService.Reply<PostPrintProof.Response> = await appmodel.server.fetch( new PostPrintProof( { templateId: id } ) );
        if( reply.ok && reply.data ) window.open( reply.data.proofUrl, "_blank" );
        else setSnack( { message: RestfulService.error( reply, "Could not render the proof" ), severity: "error" } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onAction( action : string, row : TableInput.Row ) : void
    {
        const found : Print.Template | undefined = templates.find( ( template : Print.Template ) : boolean => template.id === row.id );
        switch( action )
        {
            case TplAction.OPEN    : if( found ) setEditing( found ); break;
            case TplAction.PREVIEW : void onPreview( row.id ); break;
            case TplAction.ARCHIVE : void onArchive( row.id ); break;
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    const columns : Array<TableInput.Column> =
    [
        { field: "name",    label: "Name",    type: TableInput.ColumnType.STRING },
        { field: "type",    label: "Type",    type: TableInput.ColumnType.STRING },
        { field: "actions", label: "",        type: TableInput.ColumnType.ACTION },
    ];
    const actions : Array<TableInput.Action> =
    [
        { id: TplAction.OPEN,    label: "Edit",    icon: <EditOutlinedIcon fontSize="small" /> },
        { id: TplAction.PREVIEW, label: "Preview", icon: <VisibilityOutlinedIcon fontSize="small" /> },
        { id: TplAction.ARCHIVE, label: "Archive", icon: <ArchiveOutlinedIcon fontSize="small" /> },
    ];
    const rows : Array<TableInput.Row> = templates.map( ( template : Print.Template ) : TableInput.Row => ( {
        id: template.id, name: template.name, type: template.type, actions: [ TplAction.OPEN, TplAction.PREVIEW, TplAction.ARCHIVE ],
    } ) );

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <AuthPage minAccess={ undefined } title={"Print Templates"}>
                <Box sx={{ p: 2 }}>
                    <Card variant="outlined">
                        <CardHeader title={"Print Templates"}
                                    subheader={"Design reusable direct-mail templates (postcard / letter / self-mailer / check)."}
                                    action={
                                        <Stack direction="row" spacing={ 1 } sx={{ mt: 1, mr: 1 }}>
                                            <ButtonIcon id="print-tpl-refresh" label={"Refresh"} icon={ <RefreshOutlinedIcon fontSize="small" /> } onClick={ () => void load() } />
                                            <Button size="small" variant="contained" startIcon={ <AddOutlinedIcon /> } onClick={ () => setCreating( true ) }>{"New template"}</Button>
                                        </Stack>
                                    } />
                        <Divider />
                        <CardContent>
                            { loading
                                ? <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}><CircularProgress size={ 18 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading…"}</Typography></Stack>
                                : rows.length === 0
                                    ? <Typography variant="body2" sx={{ color: "text.secondary" }}>{"No templates yet. Create one to get started."}</Typography>
                                    : <TableInput id="print-templates" columns={ columns } data={ rows } actions={ actions } onAction={ onAction } selectable={ TableInput.Selectable.NONE } /> }
                        </CardContent>
                    </Card>
                </Box>

                { creating && <NewPrintTemplateDialog onCreate={ onCreate } onClose={ () => setCreating( false ) } /> }
                { editing && <PrintTemplateSchemaDialog template={ editing } onSave={ ( name, schema ) => onSaveSchema( editing.id, name, schema ) } onClose={ () => setEditing( null ) } /> }

                { snack && <SnackAlert message={ snack.message } severity={ snack.severity } onClose={ () => setSnack( null ) } /> }
            </AuthPage>;
}

export namespace PrintTemplates
{
    export interface Props {}
}

export default PrintTemplates;
// eof
