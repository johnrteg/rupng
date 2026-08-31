import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Card, CardActions, CardContent, CardHeader, CircularProgress, Divider, Stack, Tab, Tabs, Tooltip, Typography } from "@mui/material";
import RefreshOutlinedIcon    from '@mui/icons-material/RefreshOutlined';
import PlayArrowOutlinedIcon  from '@mui/icons-material/PlayArrowOutlined';
import EventRepeatOutlinedIcon from '@mui/icons-material/EventRepeatOutlined';
import DownloadOutlinedIcon   from '@mui/icons-material/DownloadOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import EditOutlinedIcon       from '@mui/icons-material/EditOutlined';
import PauseOutlinedIcon      from '@mui/icons-material/PauseOutlined';
import PlayCircleOutlinedIcon from '@mui/icons-material/PlayCircleOutlined';

import { Access } from '@repo/system';
import
{
    Report, REPORT_CATALOG, findReport, Paging,
    GetReportSubmissions, GetReportSubmissionDownload, DeleteReportSubmission, PostReportRuns,
    GetReportSchedules, PatchReportSchedule, DeleteReportSchedule,
    PostReportSchedulePause, PostReportScheduleResume,
} from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import AuthPage    from '@widgets/app/AuthPage';
import ButtonIcon  from '@widgets/core/ButtonIcon';
import ChipStatus  from '@widgets/core/ChipStatus';
import TableInput  from '@widgets/core/TableInput';
import Pusher      from '@widgets/core/Pusher';
import Colors      from '@utils/Colors';
import SnackAlert  from '@widgets/core/SnackAlert';
import AlertPrompt from '@widgets/core/AlertPrompt';

import ReportSubmitDialog   from './dialogs/ReportSubmitDialog';
import ReportScheduleDialog from './dialogs/ReportScheduleDialog';

// TableInput row-action ids (submissions + schedules share the DELETE id; the rest are tab-specific)
enum SubmissionAction { DOWNLOAD = "download", DELETE = "delete" }
enum ScheduleAction { EDIT = "edit", PAUSE = "pause", RESUME = "resume", DELETE = "delete" }

//
// ReportsPage — the reporting factory's dashboard (report-1.x/2.x/4.x): a role-filtered catalog of runnable
// reports (Run now / Schedule), the account's ad-hoc submission history (download/delete), and its recurring
// schedules (pause/resume/edit/delete). Reads/writes go through the report service's USER-gated endpoints;
// the catalog itself is a CODE-defined registry shared with the client at build time (no fetch needed).
//
export function ReportsPage( props : ReportsPage.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const role     : Access.Role = appmodel.auth.role();

    // the catalog filtered to what the caller's role may run — same ladder check as the nav's own gating
    const reports : Array<Report.Definition> = REPORT_CATALOG.filter( ( report : Report.Definition ) : boolean => Access.isAllowed( role, report.minAccess ) );

    const [tab,setTab] = React.useState< ReportsPage.Tab >( props.initialTab ?? ReportsPage.Tab.CATALOG );

    const [submissions,setSubmissions]         = React.useState< Array<Report.Submission> >( [] );
    const [submissionsPage,setSubmissionsPage] = React.useState< Paging.Page | null >( null );
    const [submissionsLoading,setSubmissionsLoading] = React.useState< boolean >( true );

    const [schedules,setSchedules]             = React.useState< Array<Report.Schedule> >( [] );
    const [schedulesPage,setSchedulesPage]     = React.useState< Paging.Page | null >( null );
    const [schedulesLoading,setSchedulesLoading] = React.useState< boolean >( true );

    // dialog state — owned here (the dialogs only compose the request + call back to do the fetch)
    const [submitOpen,setSubmitOpen]       = React.useState< boolean >( false );
    const [submitReport,setSubmitReport]   = React.useState< Report.Definition | null >( null );
    const [scheduleOpen,setScheduleOpen]   = React.useState< boolean >( false );
    const [scheduleReport,setScheduleReport] = React.useState< Report.Definition | null >( null );
    const [scheduleTarget,setScheduleTarget] = React.useState< Report.Schedule | undefined >( undefined );   // present = edit

    // pending-confirm state (archive-style: a row is staged, AlertPrompt confirms, then the delete fires)
    const [deleteSubmission,setDeleteSubmission] = React.useState< Report.Submission | null >( null );
    const [deleteSchedule,setDeleteSchedule]     = React.useState< Report.Schedule | null >( null );

    const [snack,setSnack] = React.useState< { message : string; severity : SnackAlert.Severity } | null >( null );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( componentLoaded, [] );

    // load both lists once on mount — small per-account collections, no lazy-per-tab fetch needed
    function componentLoaded() : void
    {
        void loadSubmissions();
        void loadSchedules();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // load a page of the account's submissions (token paging — TableInput drives next via onNext)
    async function loadSubmissions( token? : string ) : Promise<void>
    {
        setSubmissionsLoading( true );
        const reply : RestfulService.Reply<GetReportSubmissions.Response> = await appmodel.server.fetch( new GetReportSubmissions( { start: token } ) );
        if( reply.ok && reply.data ) { setSubmissions( reply.data.records ); setSubmissionsPage( reply.data.page ); }
        setSubmissionsLoading( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // load a page of the account's schedules (token paging)
    async function loadSchedules( token? : string ) : Promise<void>
    {
        setSchedulesLoading( true );
        const reply : RestfulService.Reply<GetReportSchedules.Response> = await appmodel.server.fetch( new GetReportSchedules( { start: token } ) );
        if( reply.ok && reply.data ) { setSchedules( reply.data.records ); setSchedulesPage( reply.data.page ); }
        setSchedulesLoading( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a catalog card's "Run" action — opens the submit dialog for that report
    function openSubmit( report : Report.Definition ) : void
    {
        setSubmitReport( report );
        setSubmitOpen( true );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a catalog card's "Schedule" action — opens the schedule dialog in CREATE mode for that report
    function openScheduleCreate( report : Report.Definition ) : void
    {
        setScheduleReport( report );
        setScheduleTarget( undefined );
        setScheduleOpen( true );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a schedule row's "Edit" action — opens the schedule dialog in EDIT mode, seeded from that schedule
    function openScheduleEdit( schedule : Report.Schedule ) : void
    {
        setScheduleReport( findReport( schedule.reportId ) ?? null );
        setScheduleTarget( schedule );
        setScheduleOpen( true );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // submit dialog's onSubmit — POSTs the ad-hoc run (no `schedule`), snacks, reloads the Submissions tab,
    // and switches to it
    async function onSubmitReport( request : Report.CreateRun ) : Promise<boolean>
    {
        const reply : RestfulService.Reply<PostReportRuns.Response> = await appmodel.server.fetch( new PostReportRuns( request ) );
        if( reply.ok && reply.data )
        {
            setSubmitOpen( false );
            setSnack( { message: "Report submitted — check the Submissions tab for status.", severity: "success" } );
            setTab( ReportsPage.Tab.SUBMISSIONS );
            void loadSubmissions();
            return true;
        }
        setSnack( { message: "Could not submit the report. Please try again.", severity: "error" } );
        return false;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // schedule dialog's onSave — PATCHes (flat fields) when editing an existing schedule, else POSTs a new
    // run with `schedule` supplied (creates the standing Schedule instead of a one-time Submission)
    async function onSaveSchedule( request : ReportScheduleDialog.Request ) : Promise<boolean>
    {
        const reply : RestfulService.Reply<PostReportRuns.Response | PatchReportSchedule.Response> = scheduleTarget
            ? await appmodel.server.fetch( new PatchReportSchedule( scheduleTarget.scheduleId, {
                  ical:         request.ical,
                  timezone:     request.timezone,
                  params:       request.params,
                  format:       request.format,
                  destinations: request.destinations,
              } ) )
            : await appmodel.server.fetch( new PostReportRuns( {
                  reportId:     request.reportId,
                  params:       request.params,
                  format:       request.format,
                  destinations: request.destinations,
                  schedule:     { ical: request.ical, timezone: request.timezone },
              } ) );
        if( reply.ok && reply.data )
        {
            setScheduleOpen( false );
            setSnack( { message: scheduleTarget ? "Schedule saved." : "Schedule created.", severity: "success" } );
            void loadSchedules();
            return true;
        }
        setSnack( { message: "Could not save the schedule. Please try again.", severity: "error" } );
        return false;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Download row action — issue a presigned GET, then open it in a new tab (no inline download handling)
    async function downloadSubmission( submission : Report.Submission ) : Promise<void>
    {
        const reply : RestfulService.Reply<GetReportSubmissionDownload.Response> = await appmodel.server.fetch( new GetReportSubmissionDownload( submission.submissionId ) );
        if( reply.ok && reply.data ) window.open( reply.data.url, "_blank" );
        else setSnack( { message: "Could not get a download link for that submission.", severity: "error" } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the submission archive confirm's action — YES deletes the pending submission; any action dismisses
    async function onDeleteSubmissionAction( action : AlertPrompt.Action ) : Promise<void>
    {
        if( deleteSubmission && action === AlertPrompt.Action.YES )
        {
            const reply : RestfulService.Reply<DeleteReportSubmission.Response> = await appmodel.server.fetch( new DeleteReportSubmission( deleteSubmission.submissionId ) );
            if( reply.ok ) { setSnack( { message: "Submission deleted.", severity: "success" } ); void loadSubmissions(); }
            else setSnack( { message: "Could not delete the submission. Please try again.", severity: "error" } );
        }
        setDeleteSubmission( null );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the schedule delete confirm's action — YES deletes the pending schedule; any action dismisses
    async function onDeleteScheduleAction( action : AlertPrompt.Action ) : Promise<void>
    {
        if( deleteSchedule && action === AlertPrompt.Action.YES )
        {
            const reply : RestfulService.Reply<DeleteReportSchedule.Response> = await appmodel.server.fetch( new DeleteReportSchedule( deleteSchedule.scheduleId ) );
            if( reply.ok ) { setSnack( { message: "Schedule deleted.", severity: "success" } ); void loadSchedules(); }
            else setSnack( { message: "Could not delete the schedule. Please try again.", severity: "error" } );
        }
        setDeleteSchedule( null );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // pause/resume are single-touch operational toggles (not a destructive action) — fire directly, no confirm
    async function pauseSchedule( schedule : Report.Schedule ) : Promise<void>
    {
        const reply : RestfulService.Reply<PostReportSchedulePause.Response> = await appmodel.server.fetch( new PostReportSchedulePause( schedule.scheduleId ) );
        if( reply.ok ) { setSnack( { message: "Schedule paused.", severity: "success" } ); void loadSchedules(); }
        else setSnack( { message: "Could not pause the schedule. Please try again.", severity: "error" } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function resumeSchedule( schedule : Report.Schedule ) : Promise<void>
    {
        const reply : RestfulService.Reply<PostReportScheduleResume.Response> = await appmodel.server.fetch( new PostReportScheduleResume( schedule.scheduleId ) );
        if( reply.ok ) { setSnack( { message: "Schedule resumed.", severity: "success" } ); void loadSchedules(); }
        else setSnack( { message: "Could not resume the schedule. Please try again.", severity: "error" } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a submissions-table row action → download or stage-for-delete
    function onSubmissionRowAction( action : string, row : TableInput.Row ) : void
    {
        const submission : Report.Submission | undefined = submissions.find( ( entry : Report.Submission ) : boolean => entry.submissionId === row.id );
        if( !submission ) return;
        if( action === SubmissionAction.DOWNLOAD ) void downloadSubmission( submission );
        if( action === SubmissionAction.DELETE )   setDeleteSubmission( submission );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a schedules-table row action → edit, pause, resume, or stage-for-delete
    function onScheduleRowAction( action : string, row : TableInput.Row ) : void
    {
        const schedule : Report.Schedule | undefined = schedules.find( ( entry : Report.Schedule ) : boolean => entry.scheduleId === row.id );
        if( !schedule ) return;
        if( action === ScheduleAction.EDIT )   openScheduleEdit( schedule );
        if( action === ScheduleAction.PAUSE )  void pauseSchedule( schedule );
        if( action === ScheduleAction.RESUME ) void resumeSchedule( schedule );
        if( action === ScheduleAction.DELETE ) setDeleteSchedule( schedule );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a submission's lifecycle status → the central status-chip color
    function submissionStatusColor( status : Report.SubmissionStatus ) : Colors.Status
    {
        switch( status )
        {
            case Report.SubmissionStatus.COMPLETE:  return Colors.Status.ACTIVE;
            case Report.SubmissionStatus.RUNNING:   return Colors.Status.INWORK;
            case Report.SubmissionStatus.ERROR:     return Colors.Status.ERROR;
            default:                                return Colors.Status.PENDING;   // SCHEDULED / SUBMITTED
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // status cell for the Submissions table
    function submissionStatusRenderer( _col : TableInput.Column, row : TableInput.Row ) : JSX.Element
    {
        return <ChipStatus size="small" label={ String( row.status ) } status={ submissionStatusColor( row.status as Report.SubmissionStatus ) } />;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a schedule's run state → the central status-chip color (AUTO_PAUSED is color-coded distinctly from a
    // deliberate PAUSED — it's the platform's own stop-loss after a generation failure, report-6.2)
    function scheduleStatusColor( status : Report.ScheduleStatus ) : Colors.Status
    {
        switch( status )
        {
            case Report.ScheduleStatus.ACTIVE:      return Colors.Status.ACTIVE;
            case Report.ScheduleStatus.AUTO_PAUSED: return Colors.Status.ERROR;
            default:                                return Colors.Status.INACTIVE;   // PAUSED (manual)
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // status cell for the Schedules table — pausedReason (when paused) shows as a tooltip on the chip
    function scheduleStatusRenderer( _col : TableInput.Column, row : TableInput.Row ) : JSX.Element
    {
        const chip : JSX.Element = <ChipStatus size="small" label={ String( row.status ) } status={ scheduleStatusColor( row.status as Report.ScheduleStatus ) } />;
        return row.pausedReason ? <Tooltip title={ String( row.pausedReason ) } arrow><span>{ chip }</span></Tooltip> : chip;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ical cell — a plain monospace render of the raw RFC-5545 string (no natural-language RRULE describer)
    function icalRenderer( _col : TableInput.Column, row : TableInput.Row ) : JSX.Element
    {
        return <Typography variant="body2" component="code" sx={{ fontFamily: "monospace" }}>{ String( row.ical ) }</Typography>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a comma-joined display of a destinations array's kinds — falls back to "Download" (the server default
    // when the list is empty/omitted)
    function destinationsLabel( destinations : Array<Report.Destination> ) : string
    {
        if( destinations.length === 0 ) return "Download";
        return destinations.map( ( destination : Report.Destination ) : string => destination.kind ).join( ", " );
    }

    // ── Submissions table config ───────────────────────────────────────────────────────────────
    const submissionActions : Array<TableInput.Action> =
    [
        { id: SubmissionAction.DOWNLOAD, label: "Download", icon: <DownloadOutlinedIcon fontSize="small" /> },
        { id: SubmissionAction.DELETE,   label: "Delete",   icon: <DeleteOutlineOutlinedIcon fontSize="small" /> },
    ];

    const submissionColumns : Array<TableInput.Column> =
    [
        { field: "report",      label: "Report",  type: TableInput.ColumnType.STRING },
        { field: "status",      label: "Status",  type: TableInput.ColumnType.CUSTOM, renderer: submissionStatusRenderer },
        { field: "format",      label: "Format",  type: TableInput.ColumnType.STRING },
        { field: "size",        label: "Size",    type: TableInput.ColumnType.BYTES },
        { field: "recordCount", label: "Records", type: TableInput.ColumnType.NUMBER },
        { field: "destinations", label: "Destinations", type: TableInput.ColumnType.STRING },
        { field: "createdAt",   label: "Created", type: TableInput.ColumnType.DATETIME },
        { field: "actions",     label: "",        type: TableInput.ColumnType.ACTION },
    ];

    const submissionRows : Array<TableInput.Row> = submissions.map( ( submission : Report.Submission ) : TableInput.Row => ( {
        id:           submission.submissionId,
        report:       findReport( submission.reportId )?.name ?? submission.reportId,
        status:       submission.status,
        format:       submission.format,
        size:         submission.size ?? 0,
        recordCount:  submission.recordCount ?? 0,
        destinations: destinationsLabel( submission.destinations ),
        createdAt:    submission.createdAt,
        actions:      submission.status === Report.SubmissionStatus.COMPLETE ? [ SubmissionAction.DOWNLOAD, SubmissionAction.DELETE ] : [ SubmissionAction.DELETE ],
    } ) );

    // ── Schedules table config ─────────────────────────────────────────────────────────────────
    const scheduleActions : Array<TableInput.Action> =
    [
        { id: ScheduleAction.EDIT,   label: "Edit",   icon: <EditOutlinedIcon fontSize="small" /> },
        { id: ScheduleAction.PAUSE,  label: "Pause",  icon: <PauseOutlinedIcon fontSize="small" /> },
        { id: ScheduleAction.RESUME, label: "Resume", icon: <PlayCircleOutlinedIcon fontSize="small" /> },
        { id: ScheduleAction.DELETE, label: "Delete", icon: <DeleteOutlineOutlinedIcon fontSize="small" /> },
    ];

    const scheduleColumns : Array<TableInput.Column> =
    [
        { field: "report",      label: "Report",   type: TableInput.ColumnType.STRING },
        { field: "ical",        label: "Recurs",   type: TableInput.ColumnType.CUSTOM, renderer: icalRenderer },
        { field: "timezone",    label: "Timezone", type: TableInput.ColumnType.STRING },
        { field: "status",      label: "Status",   type: TableInput.ColumnType.CUSTOM, renderer: scheduleStatusRenderer },
        { field: "destinations", label: "Destinations", type: TableInput.ColumnType.STRING },
        { field: "nextFireAt",  label: "Next fire", type: TableInput.ColumnType.DATETIME },
        { field: "actions",     label: "",         type: TableInput.ColumnType.ACTION },
    ];

    const scheduleRows : Array<TableInput.Row> = schedules.map( ( schedule : Report.Schedule ) : TableInput.Row => ( {
        id:           schedule.scheduleId,
        report:       findReport( schedule.reportId )?.name ?? schedule.reportId,
        ical:         schedule.ical,
        timezone:     schedule.timezone,
        status:       schedule.status,
        pausedReason: schedule.pausedReason ?? "",
        destinations: destinationsLabel( schedule.destinations ),
        nextFireAt:   schedule.nextFireAt ?? null,
        actions:      schedule.status === Report.ScheduleStatus.ACTIVE
            ? [ ScheduleAction.EDIT, ScheduleAction.PAUSE, ScheduleAction.DELETE ]
            : [ ScheduleAction.EDIT, ScheduleAction.RESUME, ScheduleAction.DELETE ],
    } ) );

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <AuthPage minAccess={ Access.AccountRole.USER } title={"Reports"}>
                <Box sx={{ p: 2, mx: "auto" }}>
                    <Card variant="outlined">
                        <CardHeader title={"Reports"}
                                    subheader={"Run a report now, put one on a recurring schedule, or check past submissions."}
                                    action={
                                        <Stack direction="row" spacing={ 1 } sx={{ mt: 1, mr: 1, alignItems: "center" }}>
                                            <ButtonIcon id="reports-refresh" label={"Refresh"} size="small"
                                                        disabled={ submissionsLoading || schedulesLoading }
                                                        icon={ <RefreshOutlinedIcon fontSize="small" /> }
                                                        onClick={ componentLoaded } />
                                        </Stack>
                                    } />
                        <Divider />
                        <Tabs value={ tab } onChange={ ( _event : React.SyntheticEvent, value : ReportsPage.Tab ) : void => setTab( value ) } sx={{ px: 2 }}>
                            <Tab value={ ReportsPage.Tab.CATALOG }     label={"Catalog"} />
                            <Tab value={ ReportsPage.Tab.SUBMISSIONS } label={"Submissions"} />
                            <Tab value={ ReportsPage.Tab.SCHEDULES }  label={"Schedules"} />
                        </Tabs>
                        <Divider />
                        <CardContent>

                            {/* ── Catalog ─────────────────────────────────────────────────────────────── */}
                            { tab === ReportsPage.Tab.CATALOG &&
                                <Stack spacing={ 2 }>
                                    { reports.length === 0 &&
                                        <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center", pt: 3 }}>{"No reports are available to your role."}</Typography> }
                                    { reports.map( ( report : Report.Definition ) : JSX.Element => (
                                        <Card key={ report.reportId } variant="outlined">
                                            <CardHeader title={ report.name } subheader={ report.description } />
                                            <CardActions>
                                                <Pusher />
                                                <ButtonIcon id={ `report-run-${ report.reportId }` } label={"Run"} icon={ <PlayArrowOutlinedIcon /> } onClick={ () => openSubmit( report ) } />
                                                <ButtonIcon id={ `report-schedule-${ report.reportId }` } label={"Schedule"} icon={ <EventRepeatOutlinedIcon /> } onClick={ () => openScheduleCreate( report ) } />
                                            </CardActions>
                                        </Card>
                                    ) ) }
                                </Stack> }

                            {/* ── Submissions ─────────────────────────────────────────────────────────── */}
                            { tab === ReportsPage.Tab.SUBMISSIONS &&
                                <>
                                    { submissionsLoading &&
                                        <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", p: 1 }}><CircularProgress size={ 18 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading…"}</Typography></Stack> }
                                    { !submissionsLoading && submissions.length === 0 &&
                                        <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center", pt: 3 }}>{"No submissions yet. Run a report from the Catalog tab."}</Typography> }
                                    { !submissionsLoading && submissions.length > 0 &&
                                        <TableInput id="report-submissions"
                                                    columns={ submissionColumns }
                                                    data={ submissionRows }
                                                    actions={ submissionActions }
                                                    onAction={ onSubmissionRowAction }
                                                    selectable={ TableInput.Selectable.NONE }
                                                    paging={ TableInput.Paging.TOKEN }
                                                    total={ submissionsPage?.total }
                                                    next={ submissionsPage?.next }
                                                    onNext={ ( token : string ) : void => void loadSubmissions( token ) } /> }
                                </> }

                            {/* ── Schedules ───────────────────────────────────────────────────────────── */}
                            { tab === ReportsPage.Tab.SCHEDULES &&
                                <>
                                    { schedulesLoading &&
                                        <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", p: 1 }}><CircularProgress size={ 18 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading…"}</Typography></Stack> }
                                    { !schedulesLoading && schedules.length === 0 &&
                                        <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center", pt: 3 }}>{"No schedules yet. Schedule a report from the Catalog tab."}</Typography> }
                                    { !schedulesLoading && schedules.length > 0 &&
                                        <TableInput id="report-schedules"
                                                    columns={ scheduleColumns }
                                                    data={ scheduleRows }
                                                    actions={ scheduleActions }
                                                    onAction={ onScheduleRowAction }
                                                    selectable={ TableInput.Selectable.NONE }
                                                    paging={ TableInput.Paging.TOKEN }
                                                    total={ schedulesPage?.total }
                                                    next={ schedulesPage?.next }
                                                    onNext={ ( token : string ) : void => void loadSchedules( token ) } /> }
                                </> }

                        </CardContent>
                    </Card>
                </Box>

                { submitOpen &&
                    <ReportSubmitDialog open={ submitOpen } report={ submitReport } onSubmit={ onSubmitReport } onClose={ () => setSubmitOpen( false ) } /> }

                { scheduleOpen &&
                    <ReportScheduleDialog open={ scheduleOpen } report={ scheduleReport } schedule={ scheduleTarget } onSave={ onSaveSchedule } onClose={ () => setScheduleOpen( false ) } /> }

                { deleteSubmission &&
                    <AlertPrompt id="report-submission-delete"
                                 type={ AlertPrompt.Type.WARNING }
                                 title={"Delete submission"}
                                 message={"Delete this submission and its artifact? This can't be undone."}
                                 yesText={"Delete"}
                                 cancelText={"Cancel"}
                                 onAction={ onDeleteSubmissionAction } /> }

                { deleteSchedule &&
                    <AlertPrompt id="report-schedule-delete"
                                 type={ AlertPrompt.Type.WARNING }
                                 title={"Delete schedule"}
                                 message={"Delete this schedule? Already-produced submissions are kept — only future fires stop."}
                                 yesText={"Delete"}
                                 cancelText={"Cancel"}
                                 onAction={ onDeleteScheduleAction } /> }

                { snack && <SnackAlert message={ snack.message } severity={ snack.severity } onClose={ () => setSnack( null ) } /> }
            </AuthPage>;
}

export namespace ReportsPage
{
    // which tab opens by default — the nav has 3 distinct entries (Submit/Scheduled/Download) that all land
    // on this one page, each defaulting to the tab matching its label
    export enum Tab
    {
        CATALOG     = 0,
        SUBMISSIONS = 1,
        SCHEDULES   = 2,
    }

    export interface Props
    {
        initialTab? : Tab;
    }
}

export default ReportsPage;
