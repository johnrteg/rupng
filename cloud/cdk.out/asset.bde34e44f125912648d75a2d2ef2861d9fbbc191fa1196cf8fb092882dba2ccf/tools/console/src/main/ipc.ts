import { ipcMain, type BrowserWindow } from "electron";

import {
    IPC,
    type ClaudeMode, type LocalStackState, type LogStream, type PipelineRequest, type StageState
} from "../shared/types";
import { listServices } from "./registry";
import { invalidatePorts } from "./ports";
import { processManager } from "./processManager";
import { logStore } from "./logStore";
import { pingAll, pingHealth } from "./health";
import { localstackDown, localstackStatus, localstackUp } from "./localstack";
import { claudePrompt } from "./claude";
import { claudeAgent } from "./claudeAgent";
import { lambdaInvoke, lambdaList, listJobs } from "./jobs";
import { apigwRoutes, cloudGraph, cloudHealth, cloudTail, ecsService, s3List } from "./cloudGraph";
import { dockerContainers } from "./docker";
import { ecsMetrics } from "./awsMetrics";
import { isReadOnly, setTarget, targetInfo } from "./aws";
import { LOG_DIR, REPO_ROOT } from "./paths";

//
// IPC wiring — the single place main exposes its surface to the renderer (via the preload bridge).
// `handle` = request/response (invoke); pushed events stream live to the window over `webContents.send`.
//

export function registerIpc( getWindow : () => BrowserWindow | null ) : void
{
    const send = ( channel : string, ...args : unknown[] ) : void =>
    {
        const win : BrowserWindow | null = getWindow();
        if ( win && !win.isDestroyed() ) win.webContents.send( channel, ...args );
    };

    // ── live event forwarding (main → renderer) ─────────────────────────────────────────────────
    logStore.on( "line", ( line ) => send( IPC.onLog, line ) );
    processManager.on( "proc", ( state ) => send( IPC.onProc, state ) );
    processManager.on( "stage", ( service : string, state : StageState ) =>
    {
        send( IPC.onStage, { service, state } );
        // auto-engage Claude on a failed stage (realtime/fix modes)
        for ( const stage of [ "build", "image", "deploy" ] as const )
            if ( state[ stage ] === "failed" ) { claudeAgent.onStageFailed( service ); break; }
    } );

    claudeAgent.on( "message", ( msg ) => send( IPC.onClaudeMessage, msg ) );
    claudeAgent.on( "approval", ( req ) => send( IPC.onClaudeApproval, req ) );
    claudeAgent.on( "state", ( state ) => send( IPC.onClaudeState, state ) );

    // ── services ────────────────────────────────────────────────────────────────────────────────
    ipcMain.handle( IPC.listServices, () => listServices() );
    ipcMain.handle( IPC.rescanServices, () => { invalidatePorts(); return listServices(); } );
    ipcMain.handle( IPC.repoRoot, () => REPO_ROOT );

    // ── pipeline ────────────────────────────────────────────────────────────────────────────────
    ipcMain.handle( IPC.runPipeline, ( _e, req : PipelineRequest ) => processManager.runPipeline( req ) );
    ipcMain.handle( IPC.getStageStates, () => processManager.allStageStates() );
    ipcMain.handle( IPC.getProcStates, () => processManager.procStates() );
    ipcMain.handle( IPC.stopStream, ( _e, service : string, stream : LogStream ) => { processManager.kill( service, stream ); } );
    ipcMain.handle( IPC.stopService, ( _e, service : string ) => { processManager.killAll( service ); } );
    ipcMain.handle( IPC.composeDown, ( _e, service : string ) => processManager.composeDown( service ) );

    // ── logs ────────────────────────────────────────────────────────────────────────────────────
    ipcMain.handle( IPC.getLog, ( _e, service : string, stream : LogStream ) => logStore.get( service, stream ) );
    ipcMain.handle( IPC.clearLog, ( _e, service : string, stream : LogStream ) => { logStore.clear( service, stream ); } );
    ipcMain.handle( IPC.logPath, ( _e, service : string, stream : LogStream ) => logStore.path( service, stream ) );
    ipcMain.handle( IPC.claudePrompt, ( _e, service : string ) => claudePrompt( service ) );

    // ── health ──────────────────────────────────────────────────────────────────────────────────
    ipcMain.handle( IPC.pingHealth, ( _e, service : string, role? : string ) => pingHealth( service, role ) );
    ipcMain.handle( IPC.pingAll, () => pingAll() );

    // ── localstack ──────────────────────────────────────────────────────────────────────────────
    ipcMain.handle( IPC.localstackStatus, async () =>
    {
        const state : LocalStackState = await localstackStatus();
        send( IPC.onLocalStack, state );
        return state;
    } );
    ipcMain.handle( IPC.localstackUp,   async () => { await localstackUp();   const s = await localstackStatus(); send( IPC.onLocalStack, s ); return s; } );
    ipcMain.handle( IPC.localstackDown, async () => { await localstackDown(); const s = await localstackStatus(); send( IPC.onLocalStack, s ); return s; } );

    // ── claude ──────────────────────────────────────────────────────────────────────────────────
    ipcMain.handle( IPC.claudeGetMode, () => claudeAgent.getMode() );
    ipcMain.handle( IPC.claudeSetMode, ( _e, mode : ClaudeMode ) => { claudeAgent.setMode( mode ); } );
    ipcMain.handle( IPC.claudeStart, ( _e, service : string ) => claudeAgent.start( service ) );
    ipcMain.handle( IPC.claudeStop, ( _e, service : string ) => { claudeAgent.stop( service ); } );
    ipcMain.handle( IPC.claudeApprove, ( _e, id : string, allow : boolean ) => { claudeAgent.approve( id, allow ); } );

    // ── jobs / lambdas ──────────────────────────────────────────────────────────────────────────
    ipcMain.handle( IPC.jobsList, ( _e, service : string ) => listJobs( service ) );
    ipcMain.handle( IPC.lambdaList, ( _e, service : string ) => lambdaList( service ) );
    ipcMain.handle( IPC.lambdaInvoke, ( _e, functionName : string, payload : string ) =>
        // never invoke functions against a real AWS account — read-only there
        isReadOnly()
            ? Promise.resolve( { ok: false, error: "Invoke is disabled while targeting a real AWS account (read-only)." } )
            : lambdaInvoke( functionName, payload ) );

    // ── cloud monitor ─────────────────────────────────────────────────────────────────────────────
    ipcMain.handle( IPC.cloudGraph, () => cloudGraph() );
    ipcMain.handle( IPC.cloudHealth, () => cloudHealth() );
    ipcMain.handle( IPC.cloudTail, ( _e, logGroup : string, limit? : number ) => cloudTail( logGroup, limit ) );
    ipcMain.handle( IPC.s3List, ( _e, bucket : string, prefix? : string ) => s3List( bucket, prefix ) );
    ipcMain.handle( IPC.apigwRoutes, ( _e, apiId : string ) => apigwRoutes( apiId ) );
    ipcMain.handle( IPC.dockerContainers, () => dockerContainers() );
    ipcMain.handle( IPC.ecsMetrics, () => ecsMetrics() );
    ipcMain.handle( IPC.ecsService, ( _e, serviceArn : string ) => ecsService( serviceArn ) );

    // ── target (LocalStack vs AWS account) ────────────────────────────────────────────────────────
    ipcMain.handle( IPC.targetGet, () => targetInfo() );
    ipcMain.handle( IPC.targetSet, async ( _e, target : Parameters<typeof setTarget>[ 0 ] ) => { setTarget( target ); return targetInfo(); } );

    void LOG_DIR; // ensured/created lazily by logStore; referenced for clarity
}
