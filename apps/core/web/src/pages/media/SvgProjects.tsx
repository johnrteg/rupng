import AppModel from "@model/AppModel";
//
import React from "react";
import { JSX } from "react";

import { Box, Button, Card, CardActionArea, CardContent, CircularProgress, Stack, Typography } from "@mui/material";
import AddOutlinedIcon     from "@mui/icons-material/AddOutlined";
import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined";
import DesignServicesOutlinedIcon from "@mui/icons-material/DesignServicesOutlined";
import MoreVertIcon             from "@mui/icons-material/MoreVert";
import ContentCopyOutlinedIcon  from "@mui/icons-material/ContentCopyOutlined";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";

import { StudioProject, Media, GetStudioProjects, PostStudioProjectCopy, DeleteStudioProject } from "@repo/api";
import { RestfulService } from "@repo/endpoint";

import AuthPage   from "@widgets/app/AuthPage";
import ButtonIcon from "@widgets/core/ButtonIcon";
import ButtonIconDropdown from "@widgets/core/ButtonIconDropdown";
import AlertPrompt from "@widgets/core/AlertPrompt";
import SnackAlert  from "@widgets/core/SnackAlert";
import LocaleService from "@model/service/LocaleService";
import SvgProjectEditor from "@pages/media/SvgProjectEditor";
import NewSvgProjectDialog from "@pages/media/dialogs/NewSvgProjectDialog";

// the per-card kebab menu actions
enum ProjectAction { COPY = "copy", DELETE = "delete" }

//
// SvgProjects — the SVG design gallery (mounted under Media → Studio). Lists the account's designs (studio
// projects), opens a design in the full-screen editor (inline, like the email templates page), and creates a
// new one via the NewSvgProjectDialog. Uses the house fetch pattern (no React Query dependency in this app).
//
export function SvgProjects() : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [ projects, setProjects ] = React.useState<Array<StudioProject.Entity>>( [] );
    const [ loading, setLoading ]   = React.useState<boolean>( true );
    const [ editingId, setEditingId ] = React.useState<string | null>( null );   // open editor for this project
    const [ newOpen, setNewOpen ]     = React.useState<boolean>( false );        // new-design dialog
    const [ deleteTarget, setDeleteTarget ] = React.useState<StudioProject.Entity | null>( null );   // pending delete confirm
    const [ snack, setSnack ]         = React.useState<{ message : string; severity : SnackAlert.Severity } | null>( null );

    React.useEffect( componentLoaded, [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    function componentLoaded() : void
    {
        void load();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // load the account's designs (image-kind studio projects host SVG docs)
    async function load() : Promise<void>
    {
        setLoading( true );
        const reply : RestfulService.Reply<GetStudioProjects.Response> = await appmodel.server.fetch( new GetStudioProjects() );
        if( reply.ok && reply.data )
        {
            const designs : Array<StudioProject.Entity> = reply.data.records.filter( ( project : StudioProject.Entity ) : boolean => project.kind === Media.Kind.IMAGE );
            setProjects( designs );
        }
        setLoading( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // open a design in the editor
    function openDesign( projectId : string ) : void
    {
        setEditingId( projectId );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a card's kebab menu choice — copy duplicates the design, delete asks for confirmation first
    function onCardAction( project : StudioProject.Entity, action : string ) : void
    {
        switch( action )
        {
            case ProjectAction.COPY:   void copyProject( project ); break;
            case ProjectAction.DELETE: setDeleteTarget( project ); break;
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // duplicate a design (metadata + canvas) into a new project, then refresh the list
    async function copyProject( project : StudioProject.Entity ) : Promise<void>
    {
        const reply : RestfulService.Reply<PostStudioProjectCopy.Response> = await appmodel.server.fetch( new PostStudioProjectCopy( project.id ) );
        if( reply.ok ) { setSnack( { message: "Design copied.", severity: "success" } ); void load(); }
        else setSnack( { message: "Could not copy the design. Please try again.", severity: "error" } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the delete confirm's YES action — soft-delete (recoverable) the pending target, then refresh
    async function onDeleteConfirmed( confirmed : AlertPrompt.Action ) : Promise<void>
    {
        const target : StudioProject.Entity | null = deleteTarget;
        setDeleteTarget( null );
        if( confirmed !== AlertPrompt.Action.YES || !target ) return;
        const reply : RestfulService.Reply<DeleteStudioProject.Response> = await appmodel.server.fetch( new DeleteStudioProject( target.id ) );
        if( reply.ok ) { setSnack( { message: "Design deleted.", severity: "success" } ); void load(); }
        else setSnack( { message: "Could not delete the design. Please try again.", severity: "error" } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a new design was created — open it in the editor and refresh the list
    function onCreated( projectId : string ) : void
    {
        setNewOpen( false );
        setEditingId( projectId );
        void load();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // close the editor + refresh (last-edited may have changed)
    function onBack() : void
    {
        setEditingId( null );
        void load();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // one design card (thumbnail placeholder + name + last edited)
    function designCard( project : StudioProject.Entity ) : JSX.Element
    {
        const edited : string = appmodel.ui.locale.date( new Date( project.modifiedAt ), LocaleService.Format.MEDIUM );
        return  <Card key={ project.id } variant="outlined" sx={{ width: 200, position: "relative" }}>
                    <Box sx={{ position: "absolute", top: 4, right: 4, zIndex: 1 }}>
                        <ButtonIconDropdown id={ `svg-project-${ project.id }-menu` } label={"More"} size="small"
                                            icon={ <MoreVertIcon fontSize="small" /> }
                                            choices={
                                            [
                                                { value: ProjectAction.COPY,   label: "Copy",   icon: <ContentCopyOutlinedIcon fontSize="small" /> },
                                                { value: ProjectAction.DELETE, label: "Delete", icon: <DeleteOutlineOutlinedIcon fontSize="small" /> },
                                            ] }
                                            onChange={ ( action : string ) : void => onCardAction( project, action ) } />
                    </Box>
                    <CardActionArea onClick={ () : void => openDesign( project.id ) }>
                        <Box sx={{ height: 140, display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "action.hover" }}>
                            <DesignServicesOutlinedIcon sx={{ fontSize: 40, color: "text.secondary" }} />
                        </Box>
                        <CardContent>
                            <Typography variant="subtitle2" noWrap>{ project.name }</Typography>
                            <Typography variant="caption" sx={{ color: "text.secondary" }}>{ edited }</Typography>
                        </CardContent>
                    </CardActionArea>
                </Card>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // when a design is open, show the full-screen editor instead of the gallery
    if( editingId !== null )
    {
        const editingProject : StudioProject.Entity | undefined = projects.find( ( p : StudioProject.Entity ) : boolean => p.id === editingId );
        return <SvgProjectEditor projectId={ editingId } projectName={ editingProject?.name } onBack={ onBack } />;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <AuthPage title={"Designs"}>
                <Box sx={{ p: 2 }}>
                    <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", mb: 2 }}>
                        <Typography variant="h6" sx={{ flexGrow: 1 }}>{"Designs"}</Typography>
                        <ButtonIcon id="svg-projects-refresh" label={"Refresh"} icon={ <RefreshOutlinedIcon fontSize="small" /> } onClick={ () : void => void load() } />
                        <Button size="small" variant="contained" startIcon={ <AddOutlinedIcon /> } onClick={ () : void => setNewOpen( true ) }>{"New Design"}</Button>
                    </Stack>

                    { loading
                        ? <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}><CircularProgress size={ 18 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading…"}</Typography></Stack>
                        : projects.length === 0
                            ? <Typography variant="body2" sx={{ color: "text.secondary" }}>{"No designs yet. Create one to get started."}</Typography>
                            : <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
                                  { projects.map( ( project : StudioProject.Entity ) : JSX.Element => designCard( project ) ) }
                              </Box> }
                </Box>

                { newOpen && <NewSvgProjectDialog open={ newOpen } onClose={ () : void => setNewOpen( false ) } onCreated={ onCreated } /> }

                { deleteTarget &&
                    <AlertPrompt id="svg-project-delete-confirm"
                                 type={ AlertPrompt.Type.WARNING }
                                 title={"Delete design"}
                                 message={ `Delete "${ deleteTarget.name }"? It can be recovered later if this was a mistake.` }
                                 yesText={"Delete"} yesColor="error" cancelText={"Cancel"}
                                 onAction={ onDeleteConfirmed } /> }

                { snack && <SnackAlert message={ snack.message } severity={ snack.severity } onClose={ () : void => setSnack( null ) } /> }
            </AuthPage>;
}

export default SvgProjects;
