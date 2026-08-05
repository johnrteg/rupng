import { ipcMain, shell, type BrowserWindow } from "electron";

import {
    IPC,
    type ClaudeMode, type LocalStackState, type LogStream, type PipelineRequest, type StageState
} from "../shared/types";
import { getService, listServices } from "./registry";
import { invalidatePorts } from "./ports";
import { invalidateManifestEnv } from "./manifestEnv";
import { processManager } from "./processManager";
import { logStore } from "./logStore";
import { pingAll, pingHealth } from "./health";
import { localstackClockSkew, localstackDown, localstackStatus, localstackUp } from "./localstack";
import { claudePrompt } from "./claude";
import { claudeAgent } from "./claudeAgent";
import { clearConversation, loadConversation } from "./claudeStore";
import { lambdaInvoke, lambdaList, listJobs } from "./jobs";
import { apigwRoutes, cloudGraph, cloudHealth, cloudTail, ecsService, s3List, s3Buckets, s3Head, s3PresignGet } from "./cloudGraph";
import { configGet, configProfiles, configSave } from "./appconfig";
import { secretsList, secretGet, secretSave, secretClear } from "./secrets";
import { dynamoDelete, dynamoPut, dynamoScan, dynamoTableInfo, dynamoTables } from "./dynamo";
import { cognitoCreateUser, cognitoDeleteUser, cognitoPools, cognitoSetEnabled, cognitoSetPassword, cognitoUpdateUser, cognitoUsers } from "./cognito";
import { dockerContainers } from "./docker";
import { ecsMetrics } from "./awsMetrics";
import { diagnoseVpcLink } from "./vpcDiag";
import { webAppUrl } from "./webApp";
import { isWatchSyncing, startWatchSync, stopWatchSync, syncSiteOnce } from "./webDev";
import { buildOrchestrator } from "./buildOrchestrator";
import type { BuildSettings, StageId } from "../shared/types";
import { listProxyConfigs, readProxyConfig, writeActiveConfig, writeProxyConfig } from "./proxyConfig";
import { gatewayTargets } from "./proxyGateway";
import { branches, bumpVersion, commitPush, createPR, npmOutdated, pull, reinstall, repoStatus, syncVersions, test, updateDeps, versionConflicts } from "./repo";
import { deployAudit, deployMap, deployProposeTag, deployRefs, deployRun, deployState, deployedVersions, gitVersions, openReleaseLine } from "./deploy";
import { manifestDrift } from "./deployState";
import { browserBack, browserForward, browserState, closeBrowser, onBrowserState, openBrowser, reloadBrowser, resizeBrowser } from "./browser";
import type { DeployEnvConfig, DeployEnvName, DeployRequest } from "../shared/types";
import { WEBPROXY_ID } from "../shared/types";
import { isReadOnly, setTarget, targetInfo } from "./aws";
import { deleteRequest, discoverEndpoints, listSaved, localApiRoutes, saveRequest, sendRequest } from "./apiTester";
import { kafkaMonitor } from "./kafkaMonitor";
import { sesClear, sesMessages } from "./ses";
import { fakeInbox, fakeClear, fakeConfigGet, fakeConfigSave } from "./fakeEmail";
import { authActionsList, authActionsCancel } from "./authActions";
import { cognitoCodes } from "./cognitoCodes";
import { killProcessTree, reapStale, scanProcesses } from "./processScan";
import { LOG_DIR, REPO_ROOT } from "./paths";

//
// IPC wiring — the single place main exposes its surface to the renderer (via the preload bridge).
// `handle` = request/response (invoke); pushed events stream live to the window over `webContents.send`.
//

/** Register every `ipcMain.handle` request/response endpoint and wire main→renderer event forwarding.
 *  Called once on app-ready; `getWindow` resolves the current window lazily (it can be recreated). */
export function registerIpc( getWindow : () => BrowserWindow | null ) : void
{
    // forward an event to the renderer, dropping it if the window/webContents has gone (reload/close race).
    // We call mainFrame.send() directly instead of webContents.send() because in Electron v22+,
    // webContents.send() wraps mainFrame.send() in a try/catch that console.error()s before rethrowing —
    // meaning our outer catch can't suppress the noisy "Render frame was disposed" log.
    // mainFrame.send() throws the same exception but without the internal logging.
    const send = ( channel : string, ...args : Array<unknown> ) : void =>
    {
        const win : BrowserWindow | null = getWindow();
        if ( !win || win.isDestroyed() || win.webContents.isDestroyed() ) return;
        try { win.webContents.mainFrame.send( channel, ...args ); }
        catch { /* render frame disposed between the check and the send — drop silently */ }
    };

    // ── live event forwarding (main → renderer) ─────────────────────────────────────────────────
    logStore.on( "line", ( line ) => send( IPC.onLog, line ) );
    processManager.on( "proc", ( state ) => send( IPC.onProc, state ) );
    buildOrchestrator.on( "queue", ( queue ) => send( IPC.onBuildQueue, queue ) );   // sequential build progress
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

    kafkaMonitor.on( "event", ( event ) => send( IPC.onMonitorEvent, event ) );   // a new bus event
    kafkaMonitor.on( "sync", ( sync ) => send( IPC.onMonitorSync, sync ) );        // delivery/bin/prune reconciliation

    // ── services ────────────────────────────────────────────────────────────────────────────────
    ipcMain.handle( IPC.listServices, () => listServices() );
    ipcMain.handle( IPC.rescanServices, () => { invalidatePorts(); invalidateManifestEnv(); buildOrchestrator.rescan(); return listServices(); } );
    ipcMain.handle( IPC.repoRoot, () => REPO_ROOT );

    // ── pipeline ────────────────────────────────────────────────────────────────────────────────
    ipcMain.handle( IPC.runPipeline, async ( _e, req : PipelineRequest ) =>
    {
        const result = await processManager.runPipeline( req );
        // local frontend deploy: BucketDeployment is skipped on LocalStack, so push the built SPA into
        // the site bucket once the stack exists (mirrors the watch-sync, but a single shot post-deploy)
        if ( result.ok && req.target === "cdklocal" && req.stages.includes( "deploy" ) && getService( req.service )?.capabilities.isFrontend )
            await syncSiteOnce( req.service );
        return result;
    } );
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
    ipcMain.handle( IPC.localstackClockSkew, () => localstackClockSkew() );
    ipcMain.handle( IPC.localstackUp,   async () => { await localstackUp();   const state = await localstackStatus(); send( IPC.onLocalStack, state ); return state; } );
    ipcMain.handle( IPC.localstackDown, async () => { await localstackDown(); const state = await localstackStatus(); send( IPC.onLocalStack, state ); return state; } );

    // ── claude ──────────────────────────────────────────────────────────────────────────────────
    ipcMain.handle( IPC.claudeGetMode, () => claudeAgent.getMode() );
    ipcMain.handle( IPC.claudeSetMode, ( _e, mode : ClaudeMode ) => { claudeAgent.setMode( mode ); } );
    ipcMain.handle( IPC.claudeStart, ( _e, service : string ) => claudeAgent.start( service ) );
    ipcMain.handle( IPC.claudeSend, ( _e, service : string, text : string ) => claudeAgent.send( service, text ) );
    ipcMain.handle( IPC.claudeStop, ( _e, service : string ) => { claudeAgent.stop( service ); } );
    ipcMain.handle( IPC.claudeApprove, ( _e, id : string, allow : boolean ) => { claudeAgent.approve( id, allow ); } );
    ipcMain.handle( IPC.claudeHistory, ( _e, service : string ) => loadConversation( service ) );
    ipcMain.handle( IPC.claudeClear, ( _e, service : string ) => { clearConversation( service ); } );

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
    ipcMain.handle( IPC.s3Buckets, ( _e, match? : string ) => s3Buckets( match ) );
    ipcMain.handle( IPC.s3Head, ( _e, bucket : string, key : string ) => s3Head( bucket, key ) );
    ipcMain.handle( IPC.s3PresignGet, ( _e, bucket : string, key : string, ttlSec? : number ) => s3PresignGet( bucket, key, ttlSec ) );
    ipcMain.handle( IPC.apigwRoutes, ( _e, apiId : string ) => apigwRoutes( apiId ) );

    // appconfig (the Config tab) — view/edit per-service config + sub-configs
    ipcMain.handle( IPC.configProfiles, ( _e, service : string ) => configProfiles( service ) );
    ipcMain.handle( IPC.configGet, ( _e, applicationId : string, profileId : string ) => configGet( applicationId, profileId ) );
    ipcMain.handle( IPC.configSave, ( _e, applicationId : string, profileId : string, environmentId : string, content : string, contentType : string ) => configSave( applicationId, profileId, environmentId, content, contentType ) );

    // secrets manager (the Secrets tab) — list a service's + platform-shared secrets, reveal + set values
    ipcMain.handle( IPC.secretsList, ( _e, service : string ) => secretsList( service ) );
    ipcMain.handle( IPC.secretsGet,  ( _e, secretId : string ) => secretGet( secretId ) );
    ipcMain.handle( IPC.secretsSave, ( _e, secretId : string, value : string ) => secretSave( secretId, value ) );
    ipcMain.handle( IPC.secretsClear, ( _e, secretId : string ) => secretClear( secretId ) );

    // dynamodb (the Data tab) — per-service tables + item browse/edit
    ipcMain.handle( IPC.dynamoTables, ( _e, service : string ) => dynamoTables( service ) );
    ipcMain.handle( IPC.dynamoTableInfo, ( _e, table : string ) => dynamoTableInfo( table ) );
    ipcMain.handle( IPC.dynamoScan, ( _e, table : string, startKey? : Record<string, unknown> ) => dynamoScan( table, startKey ) );
    ipcMain.handle( IPC.dynamoPut, ( _e, table : string, item : Record<string, unknown> ) => dynamoPut( table, item ) );
    ipcMain.handle( IPC.dynamoDelete, ( _e, table : string, key : Record<string, unknown> ) => dynamoDelete( table, key ) );

    // cognito (the Cognito tab, auth) — user pool + user browse/edit
    ipcMain.handle( IPC.cognitoPools, ( _e, service : string ) => cognitoPools( service ) );
    ipcMain.handle( IPC.cognitoUsers, ( _e, poolId : string, filter? : string ) => cognitoUsers( poolId, filter ) );
    ipcMain.handle( IPC.cognitoCreateUser, ( _e, poolId : string, username : string, attributes : Record<string, string>, tempPassword? : string ) => cognitoCreateUser( poolId, username, attributes, tempPassword ) );
    ipcMain.handle( IPC.cognitoUpdateUser, ( _e, poolId : string, username : string, attributes : Record<string, string> ) => cognitoUpdateUser( poolId, username, attributes ) );
    ipcMain.handle( IPC.cognitoSetEnabled, ( _e, poolId : string, username : string, enabled : boolean ) => cognitoSetEnabled( poolId, username, enabled ) );
    ipcMain.handle( IPC.cognitoDeleteUser, ( _e, poolId : string, username : string ) => cognitoDeleteUser( poolId, username ) );
    ipcMain.handle( IPC.cognitoSetPassword, ( _e, poolId : string, username : string, password : string, permanent : boolean ) => cognitoSetPassword( poolId, username, password, permanent ) );
    ipcMain.handle( IPC.dockerContainers, () => dockerContainers() );
    ipcMain.handle( IPC.ecsMetrics, () => ecsMetrics() );
    ipcMain.handle( IPC.ecsService, ( _e, serviceArn : string ) => ecsService( serviceArn ) );
    ipcMain.handle( IPC.vpcLinkDiagnose, () => diagnoseVpcLink() );
    ipcMain.handle( IPC.webAppUrl, ( _e, service : string ) => webAppUrl( service ) );
    ipcMain.handle( IPC.openExternal, ( _e, url : string ) => { void shell.openExternal( url ); } );

    // ── local dev processes: vite dev server, webproxy edge, build-watch + S3 sync ─────────────────
    ipcMain.handle( IPC.devStart, ( _e, service : string ) => { void processManager.startLocal( service ); } );
    ipcMain.handle( IPC.devStop, ( _e, service : string ) => { void processManager.stopLocal( service ); } );
    ipcMain.handle( IPC.tailDeployedStart, ( _e, service : string ) => { processManager.tailDeployed( service ); } );
    ipcMain.handle( IPC.tailDeployedStop, ( _e, service : string ) => { processManager.stopTailDeployed( service ); } );
    ipcMain.handle( IPC.deployedPorts, ( _e, service : string ) => processManager.deployedPorts( service ) );
    ipcMain.handle( IPC.manifestDrift, ( _e, service : string ) => manifestDrift( service ) );
    ipcMain.handle( IPC.proxyStart, ( _e, port? : number ) => { processManager.startProxy( port ); } );
    ipcMain.handle( IPC.proxyStop, () => { processManager.kill( WEBPROXY_ID, "runtime" ); } );
    ipcMain.handle( IPC.proxyRestart, ( _e, port? : number ) => { processManager.restartProxy( port ); } );
    ipcMain.handle( IPC.proxyState, () => processManager.isRunning( WEBPROXY_ID, "runtime" ) );
    ipcMain.handle( IPC.proxyConfigList, () => listProxyConfigs() );
    ipcMain.handle( IPC.proxyConfigGet, ( _e, name : string ) => readProxyConfig( name ) );
    ipcMain.handle( IPC.proxyConfigSave, ( _e, name : string, config : Parameters<typeof writeProxyConfig>[ 1 ] ) => writeProxyConfig( name, config ) );
    ipcMain.handle( IPC.proxyApply, ( _e, config : Parameters<typeof writeActiveConfig>[ 0 ] ) => writeActiveConfig( config ) );
    ipcMain.handle( IPC.proxyGatewayTargets, () => gatewayTargets() );
    ipcMain.handle( IPC.proxyLocalRoutes, () => localApiRoutes() );

    // ── repo (git check-out / check-in) ────────────────────────────────────────────────────────────
    ipcMain.handle( IPC.repoStatus, () => repoStatus() );
    ipcMain.handle( IPC.repoBranches, () => branches() );
    ipcMain.handle( IPC.repoPull, ( _e, branch? : string ) => pull( branch ) );
    ipcMain.handle( IPC.repoReinstall, () => reinstall() );
    ipcMain.handle( IPC.repoBump, ( _e, area : string, kind : Parameters<typeof bumpVersion>[ 1 ] ) => bumpVersion( area, kind ) );
    ipcMain.handle( IPC.repoTest, ( _e, areas : Array<string> ) => test( areas ) );
    ipcMain.handle( IPC.repoCommitPush, ( _e, branch : string, message : string, paths : Array<string> ) => commitPush( branch, message, paths ) );
    ipcMain.handle( IPC.repoCreatePR, ( _e, branch : string, title : string, paths : Array<string> ) => createPR( branch, title, paths ) );
    ipcMain.handle( IPC.repoOutdated, () => npmOutdated() );
    ipcMain.handle( IPC.repoUpdateDeps, ( _e, names : Array<string> ) => updateDeps( names ) );
    ipcMain.handle( IPC.repoVersionConflicts, () => versionConflicts() );
    ipcMain.handle( IPC.repoSyncVersions, ( _e, names : Array<string> ) => syncVersions( names ) );
    ipcMain.handle( IPC.watchSyncStart, ( _e, service : string ) => startWatchSync( service ) );
    ipcMain.handle( IPC.watchSyncStop, ( _e, service : string ) => { stopWatchSync( service ); } );
    ipcMain.handle( IPC.watchSyncState, ( _e, service : string ) => isWatchSyncing( service ) );

    // ── build orchestration (auto-build/deploy/refresh + sequential cross-service queue) ───────────
    ipcMain.handle( IPC.buildConfigure, ( _e, settings : Record<string, BuildSettings> ) => { buildOrchestrator.configure( settings ); } );
    ipcMain.handle( IPC.buildQueueGet, () => buildOrchestrator.queueState() );
    ipcMain.handle( IPC.buildRunStep, ( _e, service : string, step : StageId ) => { buildOrchestrator.runStepNow( service, step ); } );
    ipcMain.handle( IPC.buildRunNow, ( _e, service : string ) => { buildOrchestrator.runNow( service ); } );
    ipcMain.handle( IPC.buildAll, ( _e, ids : Array<string>, runId? : string ) => { buildOrchestrator.buildAll( ids, runId ); } );

    // ── deploy (git → real AWS environment) ──────────────────────────────────────────────────────
    ipcMain.handle( IPC.deployRefs, () => deployRefs() );
    ipcMain.handle( IPC.deployGitVersions, ( _e, ref : string, services : Array<string> ) => gitVersions( ref, services ) );
    ipcMain.handle( IPC.deployedVersions, ( _e, config : DeployEnvConfig ) => deployedVersions( config ) );
    ipcMain.handle( IPC.deployRun, ( _e, req : DeployRequest ) => deployRun( req ) );
    ipcMain.handle( IPC.deployMap, ( _e, configs : Record<DeployEnvName, DeployEnvConfig> ) => deployMap( configs ) );
    ipcMain.handle( IPC.deployState, () => deployState() );
    ipcMain.handle( IPC.deployAudit, ( _e, limit? : number ) => deployAudit( limit ) );
    ipcMain.handle( IPC.deployProposeTag, ( _e, ref : string ) => deployProposeTag( ref ) );
    ipcMain.handle( IPC.deployOpenLine, () => openReleaseLine() );

    // ── in-app browser window (its own resizable window; console captured to the Trace view) ───────
    onBrowserState( ( state ) => send( IPC.onBrowser, state ) );
    ipcMain.handle( IPC.browserOpen, ( _e, url : string ) => openBrowser( url ) );
    ipcMain.handle( IPC.browserClose, () => { closeBrowser(); } );
    ipcMain.handle( IPC.browserReload, () => { reloadBrowser(); } );
    ipcMain.handle( IPC.browserBack, () => { browserBack(); } );
    ipcMain.handle( IPC.browserForward, () => { browserForward(); } );
    ipcMain.handle( IPC.browserResize, ( _e, width : number, height : number ) => { resizeBrowser( width, height ); } );
    ipcMain.handle( IPC.browserState, () => browserState() );

    // ── api tester ────────────────────────────────────────────────────────────────────────────────
    ipcMain.handle( IPC.apiDiscover, ( _e, service : string ) => discoverEndpoints( service ) );
    ipcMain.handle( IPC.apiSend, ( _e, spec : Parameters<typeof sendRequest>[ 0 ] ) => sendRequest( spec ) );
    ipcMain.handle( IPC.apiSavedList, ( _e, service : string ) => listSaved( service ) );
    ipcMain.handle( IPC.apiSavedSave, ( _e, service : string, req : Parameters<typeof saveRequest>[ 1 ] ) => saveRequest( service, req ) );
    ipcMain.handle( IPC.apiSavedDelete, ( _e, service : string, id : string ) => deleteRequest( service, id ) );

    // ── target (LocalStack vs AWS account) ────────────────────────────────────────────────────────
    ipcMain.handle( IPC.targetGet, () => targetInfo() );
    ipcMain.handle( IPC.targetSet, async ( _e, target : Parameters<typeof setTarget>[ 0 ] ) => { setTarget( target ); return targetInfo(); } );

    // ── kafka monitor (the Events sub-tab) ──────────────────────────────────────────────────────────
    ipcMain.handle( IPC.monitorStart, () => kafkaMonitor.start() );
    ipcMain.handle( IPC.monitorStop, async () => { await kafkaMonitor.stop(); } );
    ipcMain.handle( IPC.monitorState, () => kafkaMonitor.state() );
    ipcMain.handle( IPC.monitorSetTtl, ( _e, ms : number ) => { kafkaMonitor.setTtl( ms ); } );
    ipcMain.handle( IPC.monitorClear, () => { kafkaMonitor.clear(); } );

    // ── ses viewer (the Email sub-tab) ───────────────────────────────────────────────────────────────
    ipcMain.handle( IPC.sesMessages, () => sesMessages() );
    ipcMain.handle( IPC.sesClear, () => sesClear() );
    ipcMain.handle( IPC.cognitoCodes, () => cognitoCodes() );

    // fake providers (Fake → Email) — the fake-email service's inbox + behavior config
    ipcMain.handle( IPC.fakeInbox, () => fakeInbox() );
    ipcMain.handle( IPC.fakeClear, () => fakeClear() );
    ipcMain.handle( IPC.fakeConfigGet, () => fakeConfigGet() );
    ipcMain.handle( IPC.fakeConfigSave, ( _event, config : unknown ) => fakeConfigSave( config ) );

    // auth actions (Actions tab) — the auth service's pending-action queue
    ipcMain.handle( IPC.authActionsList, ( _event, status : string ) => authActionsList( status ) );
    ipcMain.handle( IPC.authActionsCancel, ( _event, actionId : string ) => authActionsCancel( actionId ) );

    // ── process monitor (the Processes sub-tab) ────────────────────────────────────────────────────────
    ipcMain.handle( IPC.processList, () => scanProcesses( processManager.ownedPids() ) );
    ipcMain.handle( IPC.processKill, ( _e, pid : number ) => { killProcessTree( pid ); } );
    ipcMain.handle( IPC.processReap, () => reapStale( processManager.ownedPids() ) );

    void LOG_DIR; // ensured/created lazily by logStore; referenced for clarity
}
