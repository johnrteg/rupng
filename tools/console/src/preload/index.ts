import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import {
    IPC,
    type ClaudeApprovalRequest, type ClaudeMessage, type ClaudeMode, type ClaudeSessionState,
    type ApiGwInfo, type CloudGraph, type CloudHealth, type ContainerInfo, type EcsServiceState,
    type VpcLinkDiagnosis, type ProxyConfig, type RepoStatus, type RepoBranches, type BumpKind,
    type HealthResult, type InvokeResult, type JobInfo, type LambdaFn,
    type LocalStackState, type LogEvent, type LogLine, type LogStream, type S3Listing,
    type Target, type TargetInfo,
    type ApiEndpointDef, type ApiRequestSpec, type ApiResponse, type SavedRequest,
    type PipelineRequest, type PipelineResult, type ProcState, type ServiceInfo, type StageState
} from "../shared/types";

//
// Preload bridge. The renderer has NO Node access (contextIsolation on, nodeIntegration off); this
// is the ONLY surface it can call. We expose a typed, minimal API over IPC. The same shape is
// re-declared on `window.api` in the renderer (see renderer/api.ts) so calls are fully typed.
//

/** Subscribe helper — returns an unsubscribe fn (so React effects can clean up). */
function on<T>( channel : string, handler : ( payload : T ) => void ) : () => void
{
    const listener = ( _e : IpcRendererEvent, payload : T ) : void => handler( payload );
    ipcRenderer.on( channel, listener );
    return () => ipcRenderer.removeListener( channel, listener );
}

const api =
{
    // services
    listServices   : () : Promise<ServiceInfo[]> => ipcRenderer.invoke( IPC.listServices ),
    rescanServices : () : Promise<ServiceInfo[]> => ipcRenderer.invoke( IPC.rescanServices ),
    repoRoot       : () : Promise<string> => ipcRenderer.invoke( IPC.repoRoot ),

    // pipeline
    runPipeline    : ( req : PipelineRequest ) : Promise<PipelineResult> => ipcRenderer.invoke( IPC.runPipeline, req ),
    getStageStates : () : Promise<Record<string, StageState>> => ipcRenderer.invoke( IPC.getStageStates ),
    getProcStates  : () : Promise<ProcState[]> => ipcRenderer.invoke( IPC.getProcStates ),
    stopStream     : ( service : string, stream : LogStream ) : Promise<void> => ipcRenderer.invoke( IPC.stopStream, service, stream ),
    stopService    : ( service : string ) : Promise<void> => ipcRenderer.invoke( IPC.stopService, service ),
    composeDown    : ( service : string ) : Promise<number> => ipcRenderer.invoke( IPC.composeDown, service ),

    // logs
    getLog       : ( service : string, stream : LogStream ) : Promise<LogLine[]> => ipcRenderer.invoke( IPC.getLog, service, stream ),
    clearLog     : ( service : string, stream : LogStream ) : Promise<void> => ipcRenderer.invoke( IPC.clearLog, service, stream ),
    logPath      : ( service : string, stream : LogStream ) : Promise<string> => ipcRenderer.invoke( IPC.logPath, service, stream ),
    claudePrompt : ( service : string ) : Promise<{ prompt : string; paths : string[] }> => ipcRenderer.invoke( IPC.claudePrompt, service ),

    // health
    pingHealth : ( service : string, role? : string ) : Promise<HealthResult[]> => ipcRenderer.invoke( IPC.pingHealth, service, role ),
    pingAll    : () : Promise<HealthResult[]> => ipcRenderer.invoke( IPC.pingAll ),

    // localstack
    localstackStatus : () : Promise<LocalStackState> => ipcRenderer.invoke( IPC.localstackStatus ),
    localstackUp     : () : Promise<LocalStackState> => ipcRenderer.invoke( IPC.localstackUp ),
    localstackDown   : () : Promise<LocalStackState> => ipcRenderer.invoke( IPC.localstackDown ),

    // claude
    claudeGetMode : () : Promise<ClaudeMode> => ipcRenderer.invoke( IPC.claudeGetMode ),
    claudeSetMode : ( mode : ClaudeMode ) : Promise<void> => ipcRenderer.invoke( IPC.claudeSetMode, mode ),
    claudeStart   : ( service : string ) : Promise<void> => ipcRenderer.invoke( IPC.claudeStart, service ),
    claudeSend    : ( service : string, text : string ) : Promise<void> => ipcRenderer.invoke( IPC.claudeSend, service, text ),
    claudeStop    : ( service : string ) : Promise<void> => ipcRenderer.invoke( IPC.claudeStop, service ),
    claudeApprove : ( id : string, allow : boolean ) : Promise<void> => ipcRenderer.invoke( IPC.claudeApprove, id, allow ),
    claudeHistory : ( service : string ) : Promise<ClaudeMessage[]> => ipcRenderer.invoke( IPC.claudeHistory, service ),
    claudeClear   : ( service : string ) : Promise<void> => ipcRenderer.invoke( IPC.claudeClear, service ),

    // jobs / lambdas
    jobsList     : ( service : string ) : Promise<JobInfo[]> => ipcRenderer.invoke( IPC.jobsList, service ),
    lambdaList   : ( service : string ) : Promise<{ functions : LambdaFn[]; error? : string }> => ipcRenderer.invoke( IPC.lambdaList, service ),
    lambdaInvoke : ( functionName : string, payload : string ) : Promise<InvokeResult> => ipcRenderer.invoke( IPC.lambdaInvoke, functionName, payload ),

    // cloud monitor
    ecsMetrics  : () : Promise<{ containers : ContainerInfo[]; error? : string }> => ipcRenderer.invoke( IPC.ecsMetrics ),
    targetGet   : () : Promise<TargetInfo> => ipcRenderer.invoke( IPC.targetGet ),
    targetSet   : ( target : Target ) : Promise<TargetInfo> => ipcRenderer.invoke( IPC.targetSet, target ),
    // api tester
    apiDiscover    : ( service : string ) : Promise<ApiEndpointDef[]> => ipcRenderer.invoke( IPC.apiDiscover, service ),
    apiSend        : ( spec : ApiRequestSpec ) : Promise<ApiResponse> => ipcRenderer.invoke( IPC.apiSend, spec ),
    apiSavedList   : ( service : string ) : Promise<SavedRequest[]> => ipcRenderer.invoke( IPC.apiSavedList, service ),
    apiSavedSave   : ( service : string, req : SavedRequest ) : Promise<SavedRequest[]> => ipcRenderer.invoke( IPC.apiSavedSave, service, req ),
    apiSavedDelete : ( service : string, id : string ) : Promise<SavedRequest[]> => ipcRenderer.invoke( IPC.apiSavedDelete, service, id ),

    cloudGraph  : () : Promise<CloudGraph> => ipcRenderer.invoke( IPC.cloudGraph ),
    cloudHealth : () : Promise<CloudHealth> => ipcRenderer.invoke( IPC.cloudHealth ),
    cloudTail   : ( logGroup : string, limit? : number ) : Promise<{ events : LogEvent[]; error? : string }> => ipcRenderer.invoke( IPC.cloudTail, logGroup, limit ),
    s3List      : ( bucket : string, prefix? : string ) : Promise<S3Listing> => ipcRenderer.invoke( IPC.s3List, bucket, prefix ),
    apigwRoutes : ( apiId : string ) : Promise<ApiGwInfo> => ipcRenderer.invoke( IPC.apigwRoutes, apiId ),
    dockerContainers : () : Promise<{ containers : ContainerInfo[]; error? : string }> => ipcRenderer.invoke( IPC.dockerContainers ),
    ecsService       : ( serviceArn : string ) : Promise<EcsServiceState> => ipcRenderer.invoke( IPC.ecsService, serviceArn ),
    vpcLinkDiagnose  : () : Promise<VpcLinkDiagnosis> => ipcRenderer.invoke( IPC.vpcLinkDiagnose ),
    webAppUrl        : ( service : string ) : Promise<{ url? : string; error? : string }> => ipcRenderer.invoke( IPC.webAppUrl, service ),
    openExternal     : ( url : string ) : Promise<void> => ipcRenderer.invoke( IPC.openExternal, url ),
    devStart         : ( service : string ) : Promise<void> => ipcRenderer.invoke( IPC.devStart, service ),
    devStop          : ( service : string ) : Promise<void> => ipcRenderer.invoke( IPC.devStop, service ),
    proxyStart       : ( port? : number ) : Promise<void> => ipcRenderer.invoke( IPC.proxyStart, port ),
    proxyStop        : () : Promise<void> => ipcRenderer.invoke( IPC.proxyStop ),
    proxyRestart     : ( port? : number ) : Promise<void> => ipcRenderer.invoke( IPC.proxyRestart, port ),
    proxyState       : () : Promise<boolean> => ipcRenderer.invoke( IPC.proxyState ),
    proxyConfigList  : () : Promise<string[]> => ipcRenderer.invoke( IPC.proxyConfigList ),
    proxyConfigGet   : ( name : string ) : Promise<{ config? : ProxyConfig; error? : string }> => ipcRenderer.invoke( IPC.proxyConfigGet, name ),
    proxyConfigSave  : ( name : string, config : ProxyConfig ) : Promise<{ ok : boolean; error? : string }> => ipcRenderer.invoke( IPC.proxyConfigSave, name, config ),
    proxyApply       : ( config : ProxyConfig ) : Promise<{ ok : boolean; error? : string }> => ipcRenderer.invoke( IPC.proxyApply, config ),
    proxyGatewayTargets : () : Promise<{ prefixes : Record<string, string>; error? : string }> => ipcRenderer.invoke( IPC.proxyGatewayTargets ),

    // repo (git check-out / check-in)
    repoStatus    : () : Promise<RepoStatus> => ipcRenderer.invoke( IPC.repoStatus ),
    repoBranches  : () : Promise<RepoBranches> => ipcRenderer.invoke( IPC.repoBranches ),
    repoPull      : ( branch? : string ) : Promise<number> => ipcRenderer.invoke( IPC.repoPull, branch ),
    repoReinstall : () : Promise<number> => ipcRenderer.invoke( IPC.repoReinstall ),
    repoBump      : ( area : string, kind : BumpKind ) : Promise<{ ok : boolean; version? : string; error? : string }> => ipcRenderer.invoke( IPC.repoBump, area, kind ),
    repoTest      : ( areas : string[] ) : Promise<number> => ipcRenderer.invoke( IPC.repoTest, areas ),
    repoCommitPush : ( branch : string, message : string, paths : string[] ) : Promise<number> => ipcRenderer.invoke( IPC.repoCommitPush, branch, message, paths ),
    repoCreatePR  : ( branch : string, title : string, paths : string[] ) : Promise<number> => ipcRenderer.invoke( IPC.repoCreatePR, branch, title, paths ),
    watchSyncStart   : ( service : string ) : Promise<{ ok : boolean; error? : string }> => ipcRenderer.invoke( IPC.watchSyncStart, service ),
    watchSyncStop    : ( service : string ) : Promise<void> => ipcRenderer.invoke( IPC.watchSyncStop, service ),
    watchSyncState   : ( service : string ) : Promise<boolean> => ipcRenderer.invoke( IPC.watchSyncState, service ),

    // live events
    onLog            : ( h : ( line : LogLine ) => void ) : () => void => on( IPC.onLog, h ),
    onProc           : ( h : ( state : ProcState ) => void ) : () => void => on( IPC.onProc, h ),
    onStage          : ( h : ( payload : { service : string; state : StageState } ) => void ) : () => void => on( IPC.onStage, h ),
    onLocalStack     : ( h : ( state : LocalStackState ) => void ) : () => void => on( IPC.onLocalStack, h ),
    onClaudeMessage  : ( h : ( msg : ClaudeMessage ) => void ) : () => void => on( IPC.onClaudeMessage, h ),
    onClaudeApproval : ( h : ( req : ClaudeApprovalRequest ) => void ) : () => void => on( IPC.onClaudeApproval, h ),
    onClaudeState    : ( h : ( state : ClaudeSessionState ) => void ) : () => void => on( IPC.onClaudeState, h )
};

export type ConsoleApi = typeof api;

contextBridge.exposeInMainWorld( "api", api );
