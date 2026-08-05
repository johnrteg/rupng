import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Button, Card, CardContent, CardHeader, Chip, CircularProgress, Divider, Stack, Typography } from "@mui/material";
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import AddOutlinedIcon     from '@mui/icons-material/AddOutlined';
import EditOutlinedIcon    from '@mui/icons-material/EditOutlined';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import SmsOutlinedIcon     from '@mui/icons-material/SmsOutlined';
import EmailOutlinedIcon   from '@mui/icons-material/EmailOutlined';
import RecordVoiceOverOutlinedIcon from '@mui/icons-material/RecordVoiceOverOutlined';
import ShareOutlinedIcon   from '@mui/icons-material/ShareOutlined';
import PrintOutlinedIcon   from '@mui/icons-material/PrintOutlined';
import CampaignOutlinedIcon from '@mui/icons-material/CampaignOutlined';

import { Access } from '@repo/system';
import { Campaign, GetCampaigns, PostCampaign, PatchCampaign, DeleteCampaign, Paging } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import AuthPage     from '@widgets/app/AuthPage';
import TextInput    from '@widgets/core/TextInput';
import ButtonIcon   from '@widgets/core/ButtonIcon';
import ChipStatus   from '@widgets/core/ChipStatus';
import TableInput   from '@widgets/core/TableInput';
import Colors       from '@utils/Colors';
import SnackAlert   from '@widgets/core/SnackAlert';
import AlertPrompt  from '@widgets/core/AlertPrompt';
import AccountChange from '@widgets/app/AccountChange';
import CampaignEditDialog from '@pages/campaigns/dialogs/CampaignEditDialog';

// TableInput row-action ids
enum CampaignAction { EDIT = "edit", ARCHIVE = "archive" }

//
// Campaigns — the account's outbound orchestration list. Lists campaigns (name + status + channels + budget),
// creates one via a dialog, and archives one (confirmed). Reads/writes go through the campaign service's
// /campaigns endpoints (USER-gated). First cut: no channel/strategy/plan editor yet — create seeds channels.
//
export function Campaigns( _props : Campaigns.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [campaigns,setCampaigns] = React.useState< Array<Campaign.Entity> >( [] );
    const [page,setPage]           = React.useState< Paging.Page | null >( null );
    const [loading,setLoading]     = React.useState< boolean >( true );
    const [search,setSearch]       = React.useState< string >( "" );
    const [editOpen,setEditOpen]   = React.useState< boolean >( false );
    const [editTarget,setEditTarget] = React.useState< Campaign.Entity | null >( null );   // null while open = create
    const [archive,setArchive]     = React.useState< Campaign.Entity | null >( null );   // pending archive → confirm
    const [snack,setSnack]         = React.useState< { message : string; severity : SnackAlert.Severity } | null >( null );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( () => { void load(); }, [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // load a page of the acting account's campaigns (token paging — TableInput drives next via onNext)
    async function load( token? : string ) : Promise<void>
    {
        setLoading( true );
        const reply : RestfulService.Reply<GetCampaigns.Response> = await appmodel.server.fetch( new GetCampaigns( { start: token } ) );
        if( reply.ok && reply.data ) { setCampaigns( reply.data.records ); setPage( reply.data.page ); }
        setLoading( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function openCreate() : void { setEditTarget( null ); setEditOpen( true ); }
    function openEdit( campaign : Campaign.Entity ) : void { setEditTarget( campaign ); setEditOpen( true ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // save the editor — PATCH when editing, else POST; reload + snack on success (true closes the dialog)
    async function onSave( draft : CampaignEditDialog.Draft ) : Promise<boolean>
    {
        const reply : RestfulService.Reply<Campaign.Entity> = editTarget
            ? await appmodel.server.fetch( new PatchCampaign( editTarget.id, { name: draft.name, objective: draft.objective, channels: draft.channels, budget: draft.budget, palette: draft.palette, fonts: draft.fonts, svgs: draft.svgs } ) )
            : await appmodel.server.fetch( new PostCampaign( { name: draft.name, objective: draft.objective, channels: draft.channels, budget: draft.budget, palette: draft.palette, fonts: draft.fonts, svgs: draft.svgs } ) );
        if( reply.ok && reply.data )
        {
            setEditOpen( false );
            setSnack( { message: editTarget ? "Campaign saved." : "Campaign created.", severity: "success" } );
            void load();
            return true;
        }
        setSnack( { message: "Could not save the campaign. Please try again.", severity: "error" } );
        return false;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the archive confirm's action: on YES archive the pending campaign (snack + reload); any action dismisses
    async function onArchiveAction( action : AlertPrompt.Action ) : Promise<void>
    {
        if( archive && action === AlertPrompt.Action.YES )
        {
            const reply : RestfulService.Reply<DeleteCampaign.Response> = await appmodel.server.fetch( new DeleteCampaign( archive.id ) );
            if( reply.ok ) { setSnack( { message: "Campaign archived.", severity: "success" } ); void load(); }
            else setSnack( { message: "Could not archive the campaign. Please try again.", severity: "error" } );
        }
        setArchive( null );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a row action → edit or open the archive confirm for that campaign
    function onCampaignAction( action : string, row : TableInput.Row ) : void
    {
        const campaign : Campaign.Entity | undefined = campaigns.find( ( entry : Campaign.Entity ) => entry.id === row.id );
        if( !campaign ) return;
        if( action === CampaignAction.EDIT )    openEdit( campaign );
        if( action === CampaignAction.ARCHIVE ) setArchive( campaign );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // status cell — a uniform status chip (central Colors.Status → theme color)
    function statusRenderer( _col : TableInput.Column, row : TableInput.Row ) : JSX.Element
    {
        return <ChipStatus size="small" label={ String( row.status ) } status={ statusColor( row.status as Campaign.Status ) } />;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // map a campaign lifecycle status → a central color status (reuse a color where fidelity isn't needed)
    function statusColor( status : Campaign.Status ) : Colors.Status
    {
        switch( status )
        {
            case Campaign.Status.APPROVED:       return Colors.Status.PRIMARY;
            case Campaign.Status.SCHEDULED:
            case Campaign.Status.SENDING:        return Colors.Status.INWORK;
            case Campaign.Status.IN_REVIEW:
            case Campaign.Status.PARTIALLY_SENT: return Colors.Status.PENDING;
            case Campaign.Status.SENT:           return Colors.Status.ACTIVE;
            case Campaign.Status.FAILED:         return Colors.Status.ERROR;
            default:                             return Colors.Status.INACTIVE;   // draft / canceled / archived
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the small leading icon for a channel (matches the schedule view's channel glyphs)
    function channelIcon( channel : Campaign.Channel ) : JSX.Element
    {
        if( channel === Campaign.Channel.TEXTING ) return <SmsOutlinedIcon fontSize="small" />;
        if( channel === Campaign.Channel.EMAIL )   return <EmailOutlinedIcon fontSize="small" />;
        if( channel === Campaign.Channel.VOICE )   return <RecordVoiceOverOutlinedIcon fontSize="small" />;
        if( channel === Campaign.Channel.SOCIAL )  return <ShareOutlinedIcon fontSize="small" />;
        if( channel === Campaign.Channel.PRINT )   return <PrintOutlinedIcon fontSize="small" />;
        return <CampaignOutlinedIcon fontSize="small" />;
    }

    // channels cell — a chip per enabled channel with a small leading icon
    function channelsRenderer( _col : TableInput.Column, row : TableInput.Row ) : JSX.Element
    {
        const campaign : Campaign.Entity | undefined = campaigns.find( ( entry : Campaign.Entity ) => entry.id === row.id );
        const enabled : Array<Campaign.ChannelConfig> = ( campaign?.channels ?? [] ).filter( ( config : Campaign.ChannelConfig ) : boolean => config.enabled );
        if( enabled.length === 0 ) return <Typography variant="body2" sx={{ color: "text.secondary" }}>{"—"}</Typography>;
        return  <Stack direction="row" spacing={ 0.5 } sx={{ flexWrap: "wrap", rowGap: 0.5 }}>
                    { enabled.map( ( config : Campaign.ChannelConfig ) : JSX.Element =>
                        <Chip key={ config.channel } size="small" variant="outlined" icon={ channelIcon( config.channel ) } label={ config.channel } sx={{ textTransform: "capitalize" }} /> ) }
                </Stack>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the campaign's hard budget cap, formatted as currency (cents → major units); dash when uncapped
    function budgetLabel( campaign : Campaign.Entity ) : string
    {
        const cents : number | undefined = campaign.budget?.hardCapCents;
        return cents !== undefined ? appmodel.ui.locale.currency( cents / 100, 2 ) : "—";
    }

    // ── TableInput config ──────────────────────────────────────────────────────────────────────
    const campaignActions : Array<TableInput.Action> =
    [
        { id: CampaignAction.EDIT,    label: "Edit",    icon: <EditOutlinedIcon fontSize="small" /> },
        { id: CampaignAction.ARCHIVE, label: "Archive", icon: <ArchiveOutlinedIcon fontSize="small" /> },
    ];

    const campaignColumns : Array<TableInput.Column> =
    [
        { field: "ref",      label: "#",        type: TableInput.ColumnType.NUMBER },
        { field: "name",     label: "Name",     type: TableInput.ColumnType.STRING },
        { field: "status",   label: "Status",   type: TableInput.ColumnType.CUSTOM,   renderer: statusRenderer },
        { field: "channels", label: "Channels", type: TableInput.ColumnType.CUSTOM,   renderer: channelsRenderer },
        { field: "budget",   label: "Budget",   type: TableInput.ColumnType.STRING },
        { field: "created",  label: "Created",  type: TableInput.ColumnType.DATETIME, options: { style: "medium" } },
        { field: "actions",  label: "",         type: TableInput.ColumnType.ACTION },
    ];

    // rows filtered by the search box (by name / objective, case-insensitive)
    const visible : Array<Campaign.Entity> = campaigns.filter( ( campaign : Campaign.Entity ) : boolean =>
        `${ campaign.name } ${ campaign.objective ?? "" }`.toLowerCase().includes( search.trim().toLowerCase() ) );

    const campaignRows : Array<TableInput.Row> = visible.map( ( campaign : Campaign.Entity ) => ( {
        id:       campaign.id,
        ref:      campaign.ref ?? null,
        name:     campaign.name,
        status:   campaign.status,
        budget:   budgetLabel( campaign ),
        created:  campaign.createdAt ? new Date( campaign.createdAt ) : undefined,
        actions:  campaign.status !== Campaign.Status.ARCHIVED ? [ CampaignAction.EDIT, CampaignAction.ARCHIVE ] : [],
    } ) );

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <AuthPage minAccess={ Access.AccountRole.USER } title={"Campaigns"}>
                <Box sx={{ p: 2, mx: "auto" }}>
                    <Card variant="outlined">
                        <CardHeader title={"Campaigns"}
                                    subheader={"Outbound efforts across your channels — each with a per-channel strategy and schedule-based plans."}
                                    action={
                                        <Stack direction="row" spacing={ 1 } sx={{ mt: 1, mr: 1, alignItems: "center" }}>
                                            <TextInput id="campaigns-search" label={"Search"} value={ search } onChange={ setSearch } sx={{ width: 220 }} placeHolder={"name, objective"} />
                                            <ButtonIcon id="campaigns-refresh" label={"Refresh"} size="small" disabled={ loading } icon={ <RefreshOutlinedIcon fontSize="small" /> } onClick={ () => void load() } />
                                            <Button variant="contained" size="small" startIcon={ <AddOutlinedIcon /> } onClick={ openCreate }>{"Create campaign"}</Button>
                                        </Stack>
                                    } />
                        <Divider />
                        <CardContent>
                            { loading &&
                                <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", p: 1 }}><CircularProgress size={ 18 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading…"}</Typography></Stack> }
                            { !loading && campaigns.length === 0 &&
                                <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center", pt: 3, pb: 1 }}>{"No campaigns yet. Create one to start orchestrating a send."}</Typography> }
                            { !loading && campaigns.length > 0 && visible.length === 0 &&
                                <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center", pt: 3, pb: 1 }}>{"No campaigns match your search."}</Typography> }
                            { !loading && visible.length > 0 &&
                                <TableInput id="campaigns-list"
                                            columns={ campaignColumns }
                                            data={ campaignRows }
                                            actions={ campaignActions }
                                            onAction={ onCampaignAction }
                                            selectable={ TableInput.Selectable.NONE }
                                            paging={ TableInput.Paging.TOKEN }
                                            total={ page?.total }
                                            next={ page?.next }
                                            onNext={ ( token : string ) : void => void load( token ) } /> }
                        </CardContent>
                    </Card>
                </Box>

                <AccountChange onClear={ () => setCampaigns( [] ) } onRefresh={ () => void load() } />

                { editOpen &&
                    <CampaignEditDialog campaign={ editTarget ?? undefined } onSave={ onSave } onClose={ () => setEditOpen( false ) } /> }

                { archive &&
                    <AlertPrompt id="campaigns-archive"
                                 type={ AlertPrompt.Type.WARNING }
                                 title={"Archive campaign"}
                                 message={ `Archive "${ archive.name }"? It becomes read-only; its history is kept for audit and it can't be reactivated.` }
                                 yesText={"Archive"}
                                 cancelText={"Cancel"}
                                 onAction={ onArchiveAction } /> }

                { snack && <SnackAlert message={ snack.message } severity={ snack.severity } onClose={ () => setSnack( null ) } /> }
            </AuthPage>;
}

export namespace Campaigns
{
    export interface Props
    {
    }
}

export default Campaigns;
