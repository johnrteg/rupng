import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Button, Chip, CircularProgress, Collapse, Divider, List, ListItemButton, ListItemIcon, ListItemText, Stack, Typography } from "@mui/material";
import AddOutlinedIcon      from '@mui/icons-material/AddOutlined';
import ExpandLessIcon       from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon       from '@mui/icons-material/ExpandMore';
import MenuOpenOutlinedIcon from '@mui/icons-material/MenuOpenOutlined';
import MenuOutlinedIcon     from '@mui/icons-material/MenuOutlined';
import MovieOutlinedIcon    from '@mui/icons-material/MovieOutlined';
import ImageOutlinedIcon    from '@mui/icons-material/ImageOutlined';
import AudiotrackOutlinedIcon from '@mui/icons-material/AudiotrackOutlined';
import BrushOutlinedIcon    from '@mui/icons-material/BrushOutlined';
import EditOutlinedIcon     from '@mui/icons-material/EditOutlined';
import CampaignOutlinedIcon from '@mui/icons-material/CampaignOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';

import { Access } from '@repo/system';
import { Media, GetCampaigns, StudioProject, GetStudioProjects, PostStudioProject, PatchStudioProject } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import LocaleService from '@model/service/LocaleService';

import AuthPage             from '@widgets/app/AuthPage';
import ButtonIcon           from '@widgets/core/ButtonIcon';
import Pusher               from '@widgets/core/Pusher';
import HelpButton           from "@widgets/core/HelpButton";

import CreateProjectDialog  from '@pages/media/studio/CreateProjectDialog';
import StudioProjectDialog  from '@pages/media/studio/StudioProjectDialog';
import StudioImageEditor    from '@pages/media/studio/image/StudioImageEditor';
import StudioVideoEditor    from '@pages/media/studio/video/StudioVideoEditor';

// the sentinel campaign-group key for projects not assigned to any campaign
const UNASSIGNED : string = "__unassigned__";

//
// Media : Studio — the creation & editing surface. Studio is PROJECT-centric (not the library): you create a
// PROJECT (a name + a media type — image / video / audio) belonging to a campaign; IMAGE projects open the
// tldraw editor. Projects persist server-side (media service: DynamoDB record + S3 canvas snapshot); the tree
// here reads/writes them via the API.
//
export function MediaStudio( _props : MediaStudio.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [projects,setProjects]     = React.useState< Array<StudioProject.Entity> >( [] );
    const [loading,setLoading]       = React.useState< boolean >( true );
    const [selectedId,setSelectedId] = React.useState< string | null >( null );
    const [createOpen,setCreateOpen] = React.useState< boolean >( false );
    const [createCampaignId,setCreateCampaignId] = React.useState< string | undefined >( undefined );   // pre-selected campaign for the create dialog
    const [treeOpen,setTreeOpen]     = React.useState< boolean >( true );
    const [campaignNames,setCampaignNames] = React.useState< Record<string, string> >( {} );   // campaignId → name (for the group headers)
    const [collapsed,setCollapsed]   = React.useState< Set<string> >( new Set<string>() );   // campaign group keys folded shut
    const [propsOpen,setPropsOpen]   = React.useState< boolean >( false );   // the properties (name + tags) dialog
    const [editing,setEditing]       = React.useState< boolean >( false );   // the open editor's edit-mode (gates the properties gear)

    const selected : StudioProject.Entity | undefined = projects.find( ( project : StudioProject.Entity ) => project.id === selectedId );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( () => { void loadProjects(); void loadCampaigns(); }, [] );

    // a project opens read-only → reset the edit-mode gate whenever the selection changes
    React.useEffect( () : void => { setEditing( false ); }, [ selectedId ] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // load the account's Studio projects from the media service
    async function loadProjects() : Promise<void>
    {
        setLoading( true );
        const reply : RestfulService.Reply<GetStudioProjects.Response> = await appmodel.server.fetch( new GetStudioProjects() );
        if( reply.ok && reply.data ) setProjects( reply.data.records );
        setLoading( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // load the account's campaigns → an id→name map so the group headers show real names
    async function loadCampaigns() : Promise<void>
    {
        const reply : RestfulService.Reply<GetCampaigns.Response> = await appmodel.server.fetch( new GetCampaigns() );
        if( !reply.ok || !reply.data ) return;
        const names : Record<string, string> = {};
        for( const campaign of reply.data.records ) names[ campaign.id ] = campaign.name;
        setCampaignNames( names );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the display name for a campaign group key
    function campaignLabel( key : string ) : string
    {
        if( key === UNASSIGNED ) return "Unassigned";
        return campaignNames[ key ] ?? key;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // projects grouped under their campaign — real campaigns first (by name), Unassigned last
    function campaignGroups() : Array<{ key : string; projects : Array<StudioProject.Entity> }>
    {
        const byCampaign : Map<string, Array<StudioProject.Entity>> = new Map<string, Array<StudioProject.Entity>>();
        for( const project of projects )
        {
            const key : string = project.campaignId && project.campaignId !== "" ? project.campaignId : UNASSIGNED;
            const bucket : Array<StudioProject.Entity> = byCampaign.get( key ) ?? [];
            bucket.push( project );
            byCampaign.set( key, bucket );
        }
        const groups : Array<{ key : string; projects : Array<StudioProject.Entity> }> = [ ...byCampaign.entries() ]
            .map( ( [ key, list ] : [ string, Array<StudioProject.Entity> ] ) => ( { key, projects: list } ) );
        groups.sort( ( left, right ) : number =>
            left.key === UNASSIGNED ? 1 : right.key === UNASSIGNED ? -1 : campaignLabel( left.key ).localeCompare( campaignLabel( right.key ) ) );
        return groups;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // open the create dialog, optionally defaulting the campaign (from a campaign row's add button)
    function openCreate( campaignId? : string ) : void
    {
        setCreateCampaignId( campaignId );
        setCreateOpen( true );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // campaign folders are OPEN by default; a key in `collapsed` is folded shut
    function toggleGroup( key : string ) : void
    {
        setCollapsed( ( prev : Set<string> ) : Set<string> =>
        {
            const next : Set<string> = new Set<string>( prev );
            if( next.has( key ) ) next.delete( key ); else next.add( key );
            return next;
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // replace one project in the list (from a server response) — the editor calls this after page / library /
    // canvas-sync updates so the tree + banner stay current without a full reload
    function onProjectChanged( project : StudioProject.Entity ) : void
    {
        setProjects( ( prev : Array<StudioProject.Entity> ) : Array<StudioProject.Entity> =>
            prev.map( ( entry : StudioProject.Entity ) : StudioProject.Entity => entry.id === project.id ? project : entry ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // create a project (from the dialog) — POST it, add + select, close the dialog
    async function onCreate( name : string, type : Media.Kind, campaignId? : string ) : Promise<boolean>
    {
        const reply : RestfulService.Reply<PostStudioProject.Response> = await appmodel.server.fetch( new PostStudioProject( { name, kind: type, campaignId, tags: [] } ) );
        if( !reply.ok || !reply.data ) return false;
        const project : StudioProject.Entity = reply.data.project;
        setProjects( [ project, ...projects ] );
        setSelectedId( project.id );
        setCreateOpen( false );
        return true;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // save the selected project's properties (name + tags) — PATCH, then reflect the returned record
    async function onSaveProperties( name : string, tags : Array<string> ) : Promise<boolean>
    {
        if( !selected ) return false;
        const reply : RestfulService.Reply<PatchStudioProject.Response> = await appmodel.server.fetch( new PatchStudioProject( selected.id, { name, tags } ) );
        if( !reply.ok || !reply.data ) return false;
        onProjectChanged( reply.data.project );
        setPropsOpen( false );
        return true;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // format an ISO timestamp for the banner (empty → em-dash)
    function formatWhen( iso? : string ) : string
    {
        if( !iso ) return "—";
        return appmodel.ui.locale.dateTime( new Date( iso ), LocaleService.Format.MEDIUM ) || "—";
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the type icon for a project row
    function typeIcon( kind : Media.Kind ) : JSX.Element
    {
        if( kind === Media.Kind.VIDEO ) return <MovieOutlinedIcon fontSize="small" />;
        if( kind === Media.Kind.AUDIO ) return <AudiotrackOutlinedIcon fontSize="small" />;
        return <ImageOutlinedIcon fontSize="small" />;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the selected project's workspace — the tldraw editor (image) or a Scenarios placeholder
    function projectView() : JSX.Element
    {
        if( !selected )
            return <Stack sx={{ alignItems: "center", justifyContent: "center", height: "100%", minHeight: 320, p: 4 }}>
                       <BrushOutlinedIcon sx={{ fontSize: 48, color: "text.disabled" }} />
                       <Typography variant="body2" sx={{ color: "text.secondary", mt: 1 }}>{"Create a project or pick one to start."}</Typography>
                   </Stack>;

        const tags : Array<string> = selected.tags ?? [];
        const isImage : boolean = selected.kind === Media.Kind.IMAGE;
        const isVideo : boolean = selected.kind === Media.Kind.VIDEO;
        const hasEditor : boolean = isImage || isVideo;   // kinds that open an editor with an edit-mode toggle

        // the project banner: name (+ created/modified audit lines only for projects WITHOUT an editor — image
        // and video projects show those in their editor footer instead), with the properties gear on the right
        const banner : JSX.Element =
            <Stack spacing={ 1 }>
                <Stack direction="row" spacing={ 1 } sx={{ alignItems: "flex-start" }}>
                    <Stack spacing={ 0.25 } sx={{ minWidth: 0 }}>
                        {/* the type icon sits in front of the project name */}
                        <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", color: "text.secondary" }}>
                            { typeIcon( selected.kind ) }
                            <Typography variant="h6" sx={{ color: "text.primary" }}>{ selected.name }</Typography>
                        </Stack>
                        { !hasEditor &&
                            <Typography variant="caption" sx={{ color: "text.secondary" }}>
                                { `Created ${ formatWhen( selected.createdAt ) }${ selected.createdBy ? ` by ${ selected.createdBy }` : "" }` }
                            </Typography> }
                        { !hasEditor &&
                            <Typography variant="caption" sx={{ color: "text.secondary" }}>
                                { `Modified ${ formatWhen( selected.modifiedAt ) }${ selected.modifiedBy ? ` by ${ selected.modifiedBy }` : "" }` }
                            </Typography> }
                    </Stack>
                    <Pusher />
                    {/* Edit — on the title line; enters the editor's edit mode (shown when an editor project is locked) */}
                    { hasEditor && !editing &&
                        <Button size="small" variant="contained" startIcon={ <EditOutlinedIcon /> } onClick={ () : void => setEditing( true ) }>{"Edit"}</Button> }
                    {/* properties gear (edit) — far right; for editor projects only while in edit mode */}
                    { ( editing || !hasEditor ) &&
                        <ButtonIcon id="studio-properties" label={"Properties"} size="small" icon={ <SettingsOutlinedIcon fontSize="small" /> } onClick={ () : void => setPropsOpen( true ) } /> }
                </Stack>
                { tags.length > 0 &&
                    <Stack direction="row" spacing={ 1 } sx={{ flexWrap: "wrap", rowGap: 0.5 }}>
                        { tags.map( ( tag : string ) : JSX.Element => <Chip key={ tag } size="small" label={ tag } /> ) }
                    </Stack> }
            </Stack>;

        // IMAGE / VIDEO projects open their editor (fills the pane); other types show the Scenarios placeholder
        if( isImage )
            return  <Stack sx={{ height: "100%", minHeight: 0 }}>
                        <Box sx={{ p: 2, pb: 1, flexShrink: 0 }}>{ banner }</Box>
                        <Box sx={{ flexGrow: 1, minHeight: 0 }}>
                            <StudioImageEditor key={ selected.id } project={ selected } editing={ editing } onProjectChanged={ onProjectChanged } onEditModeChange={ setEditing } />
                        </Box>
                    </Stack>;

        if( isVideo )
            return  <Stack sx={{ height: "100%", minHeight: 0 }}>
                        <Box sx={{ p: 2, pb: 1, flexShrink: 0 }}>{ banner }</Box>
                        <Box sx={{ flexGrow: 1, minHeight: 0 }}>
                            <StudioVideoEditor key={ selected.id } project={ selected } editing={ editing } onProjectChanged={ onProjectChanged } onEditModeChange={ setEditing } />
                        </Box>
                    </Stack>;

        return  <Stack spacing={ 2 } sx={{ p: 2 }}>
                    { banner }
                    <Divider />
                    <Stack sx={{ alignItems: "center", justifyContent: "center", minHeight: 260, border: "1px dashed", borderColor: "divider", borderRadius: 1, p: 4, textAlign: "center" }}>
                        <Typography variant="subtitle1">{"Scenarios"}</Typography>
                        <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5, maxWidth: 460 }}>
                            { "Scenarios — the editable steps of this project — are coming next. You'll compose media, captions, and effects here." }
                        </Typography>
                        <Button variant="outlined" startIcon={ <AddOutlinedIcon /> } disabled sx={{ mt: 2 }}>{"Add scenario"}</Button>
                    </Stack>
                </Stack>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <AuthPage minAccess={ Access.AccountRole.USER } title={"Media : Studio"}>
                <Box sx={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>

                    {/* studio bar: toggle projects · title · Create */}
                    <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", px: 1.5, py: 0.75, borderBottom: 1, borderColor: "divider", flexShrink: 0 }}>
                        <ButtonIcon id="studio-toggle-tree" label={ treeOpen ? "Hide projects" : "Show projects" } size="small"
                                    icon={ treeOpen ? <MenuOpenOutlinedIcon /> : <MenuOutlinedIcon /> } onClick={ () : void => setTreeOpen( ( open : boolean ) : boolean => !open ) } />
                        <Typography variant="subtitle1">{"Studio"}</Typography>
                        <Pusher />
                        <Button variant="contained" size="small" startIcon={ <AddOutlinedIcon /> } onClick={ () : void => openCreate( undefined ) }>{"Create"}</Button>
                        <HelpButton value={"5454594759475"} />
                    </Stack>

                    {/* projects (left) + project workspace (right) */}
                    <Box sx={{ flexGrow: 1, minHeight: 0, display: "flex", flexDirection: "row" }}>
                        { treeOpen &&
                            <>
                                <Box sx={{ width: 280, flexShrink: 0, overflowY: "auto", p: 1 }}>
                                    { loading
                                        ? <Stack sx={{ alignItems: "center", p: 3 }}><CircularProgress size={ 22 } /></Stack>
                                        : projects.length === 0
                                            ? <Typography variant="body2" sx={{ color: "text.secondary", p: 2 }}>{"No projects yet. Click Create to start one."}</Typography>
                                            : <List dense disablePadding>
                                                  { campaignGroups().map( ( group : { key : string; projects : Array<StudioProject.Entity> } ) => (
                                                      <Box key={ group.key }>
                                                          {/* campaign parent row — click to fold/unfold like a folder; "+" creates a project pre-set to this campaign */}
                                                          <Stack direction="row" spacing={ 0.5 } sx={{ alignItems: "center", pr: 0.5 }}>
                                                              <ListItemButton onClick={ () : void => toggleGroup( group.key ) } sx={{ borderRadius: 1, py: 0.5, flexGrow: 1, minWidth: 0 }}>
                                                                  <ListItemIcon sx={{ minWidth: 24, color: "text.secondary" }}>{ collapsed.has( group.key ) ? <ExpandMoreIcon fontSize="small" /> : <ExpandLessIcon fontSize="small" /> }</ListItemIcon>
                                                                  <ListItemIcon sx={{ minWidth: 28, color: "text.secondary" }}><CampaignOutlinedIcon fontSize="small" /></ListItemIcon>
                                                                  <ListItemText primary={ campaignLabel( group.key ) } sx={{ "& .MuiListItemText-primary": { fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }} />
                                                                  <Chip size="small" variant="outlined" label={ group.projects.length } sx={{ height: 18 }} />
                                                              </ListItemButton>
                                                              { group.key !== UNASSIGNED &&
                                                                  <ButtonIcon id={ `add-${ group.key }` } label={"Add project to this campaign"} size="small" icon={ <AddOutlinedIcon fontSize="small" /> } onClick={ () => openCreate( group.key ) } /> }
                                                          </Stack>
                                                          {/* the campaign's projects, indented — folds with the folder */}
                                                          <Collapse in={ !collapsed.has( group.key ) } timeout="auto" unmountOnExit>
                                                              { group.projects.map( ( project : StudioProject.Entity ) => (
                                                                  <ListItemButton key={ project.id } selected={ selectedId === project.id } onClick={ () : void => setSelectedId( project.id ) } sx={{ borderRadius: 1, pl: 4, py: 0.25 }}>
                                                                      <ListItemIcon sx={{ minWidth: 30, color: "text.secondary" }}>{ typeIcon( project.kind ) }</ListItemIcon>
                                                                      <ListItemText primary={ project.name } sx={{ "& .MuiListItemText-primary": { fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }} />
                                                                  </ListItemButton>
                                                              ) ) }
                                                          </Collapse>
                                                      </Box>
                                                  ) ) }
                                              </List> }
                                </Box>
                                <Divider orientation="vertical" flexItem />
                            </> }

                        {/* image projects host the full-height tldraw editor (no page scroll); others scroll */}
                        <Box sx={{ flexGrow: 1, minWidth: 0, minHeight: 0, overflowY: ( selected?.kind === Media.Kind.IMAGE || selected?.kind === Media.Kind.VIDEO ) ? "hidden" : "auto" }}>
                            { projectView() }
                        </Box>
                    </Box>

                </Box>

                { createOpen &&
                    <CreateProjectDialog defaultCampaignId={ createCampaignId } onCreate={ onCreate } onClose={ () : void => { setCreateOpen( false ); setCreateCampaignId( undefined ); } } /> }

                { propsOpen && selected &&
                    <StudioProjectDialog project={ selected } onSave={ onSaveProperties } onClose={ () : void => setPropsOpen( false ) } /> }
            </AuthPage>;
}

export namespace MediaStudio
{
    export interface Props {}
}

export default MediaStudio;
// eof
