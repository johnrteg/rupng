import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import {
    IPC,
    type ClaudeApprovalRequest, type ClaudeMessage, type ClaudeMode, type ClaudeSessionState,
    type ApiGwInfo, type CloudGraph, type CloudHealth, type ContainerInfo, type EcsServiceState,
    type VpcLinkDiagnosis, type ProxyConfig, type ProxyRoute, type RepoStatus, type RepoBranches, type NpmOutdated, type VersionConflict, type BumpKind,
    type ClockSkew, type HealthResult, type InvokeResult, type JobInfo, type LambdaFn,
    type LocalStackState, type LogEvent, type LogLine, type LogStream, type S3Listing, type S3ObjectHead,
    type Target, type TargetInfo,
    type ApiEndpointDef, type ApiRequestSpec, type ApiResponse, type SavedRequest,
    type ServiceConfigTree, type ConfigContent, type ConfigSaveResult,
    type SecretList, type SecretValue, type SecretSaveResult,
    type DynamoTable, type DynamoKeySchema, type DynamoScanResult, type DynamoSaveResult,
    type CognitoPool, type CognitoUser, type CognitoResult,
    type PipelineRequest, type PipelineResult, type ProcState, type ServiceInfo, type StageId, type StageState,
    type DeployRequest, type DeployResult, type DeployEnvConfig, type DeployEnvName, type DeployMap, type DeployState, type AuditEntry,
    type BrowserState, type BuildSettings, type BuildQueue, type ManifestDrift,
    type MonitorState, type MonitorEvent, type MonitorSync,
    type SesListing, type CognitoCodeListing,
    type FakeEmailListing, type FakeEmailConfigResult, type FakeEmailSaveResult,
    type AuthActionsListing, type AuthActionCancelResult,
    type ProcessListing, type ReapResult
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
    listServices   : () : Promise<Array<ServiceInfo>> => ipcRenderer.invoke( IPC.listServices ),
    rescanServices : () : Promise<Array<ServiceInfo>> => ipcRenderer.invoke( IPC.rescanServices ),
    repoRoot       : () : Promise<string> => ipcRenderer.invoke( IPC.repoRoot ),

    // pipeline
    runPipeline    : ( req : PipelineRequest ) : Promise<PipelineResult> => ipcRenderer.invoke( IPC.runPipeline, req ),
    getStageStates : () : Promise<Record<string, StageState>> => ipcRenderer.invoke( IPC.getStageStates ),
    getProcStates  : () : Promise<Array<ProcState>> => ipcRenderer.invoke( IPC.getProcStates ),
    stopStream     : ( service : string, stream : LogStream ) : Promise<void> => ipcRenderer.invoke( IPC.stopStream, service, stream ),
    stopService    : ( service : string ) : Promise<void> => ipcRenderer.invoke( IPC.stopService, service ),
    composeDown    : ( service : string ) : Promise<number> => ipcRenderer.invoke( IPC.composeDown, service ),

    // logs
    getLog       : ( service : string, stream : LogStream ) : Promise<Array<LogLine>> => ipcRenderer.invoke( IPC.getLog, service, stream ),
    clearLog     : ( service : string, stream : LogStream ) : Promise<void> => ipcRenderer.invoke( IPC.clearLog, service, stream ),
    logPath      : ( service : string, stream : LogStream ) : Promise<string> => ipcRenderer.invoke( IPC.logPath, service, stream ),
    claudePrompt : ( service : string ) : Promise<{ prompt : string; paths : Array<string> }> => ipcRenderer.invoke( IPC.claudePrompt, service ),

    // health
    pingHealth : ( service : string, role? : string ) : Promise<Array<HealthResult>> => ipcRenderer.invoke( IPC.pingHealth, service, role ),
    pingAll    : () : Promise<Array<HealthResult>> => ipcRenderer.invoke( IPC.pingAll ),

    // localstack
    localstackStatus    : () : Promise<LocalStackState> => ipcRenderer.invoke( IPC.localstackStatus ),
    localstackClockSkew : () : Promise<ClockSkew> => ipcRenderer.invoke( IPC.localstackClockSkew ),
    localstackUp        : () : Promise<LocalStackState> => ipcRenderer.invoke( IPC.localstackUp ),
    localstackDown      : () : Promise<LocalStackState> => ipcRenderer.invoke( IPC.localstackDown ),

    // claude
    claudeGetMode : () : Promise<ClaudeMode> => ipcRenderer.invoke( IPC.claudeGetMode ),
    claudeSetMode : ( mode : ClaudeMode ) : Promise<void> => ipcRenderer.invoke( IPC.claudeSetMode, mode ),
    claudeStart   : ( service : string ) : Promise<void> => ipcRenderer.invoke( IPC.claudeStart, service ),
    claudeSend    : ( service : string, text : string ) : Promise<void> => ipcRenderer.invoke( IPC.claudeSend, service, text ),
    claudeStop    : ( service : string ) : Promise<void> => ipcRenderer.invoke( IPC.claudeStop, service ),
    claudeApprove : ( id : string, allow : boolean ) : Promise<void> => ipcRenderer.invoke( IPC.claudeApprove, id, allow ),
    claudeHistory : ( service : string ) : Promise<Array<ClaudeMessage>> => ipcRenderer.invoke( IPC.claudeHistory, service ),
    claudeClear   : ( service : string ) : Promise<void> => ipcRenderer.invoke( IPC.claudeClear, service ),

    // jobs / lambdas
    jobsList     : ( service : string ) : Promise<Array<JobInfo>> => ipcRenderer.invoke( IPC.jobsList, service ),
    lambdaList   : ( service : string ) : Promise<{ functions : Array<LambdaFn>; error? : string }> => ipcRenderer.invoke( IPC.lambdaList, service ),
    lambdaInvoke : ( functionName : string, payload : string ) : Promise<InvokeResult> => ipcRenderer.invoke( IPC.lambdaInvoke, functionName, payload ),

    // cloud monitor
    ecsMetrics  : () : Promise<{ containers : Array<ContainerInfo>; error? : string }> => ipcRenderer.invoke( IPC.ecsMetrics ),
    targetGet   : () : Promise<TargetInfo> => ipcRenderer.invoke( IPC.targetGet ),
    targetSet   : ( target : Target ) : Promise<TargetInfo> => ipcRenderer.invoke( IPC.targetSet, target ),

    // appconfig (the Config tab)
    configProfiles : ( service : string ) : Promise<ServiceConfigTree> => ipcRenderer.invoke( IPC.configProfiles, service ),
    configGet      : ( applicationId : string, profileId : string ) : Promise<ConfigContent> => ipcRenderer.invoke( IPC.configGet, applicationId, profileId ),
    configSave     : ( applicationId : string, profileId : string, environmentId : string, content : string, contentType : string ) : Promise<ConfigSaveResult> => ipcRenderer.invoke( IPC.configSave, applicationId, profileId, environmentId, content, contentType ),

    // secrets manager (the Secrets tab)
    secretsList : ( service : string ) : Promise<SecretList> => ipcRenderer.invoke( IPC.secretsList, service ),
    secretsGet  : ( secretId : string ) : Promise<SecretValue> => ipcRenderer.invoke( IPC.secretsGet, secretId ),
    secretsSave : ( secretId : string, value : string ) : Promise<SecretSaveResult> => ipcRenderer.invoke( IPC.secretsSave, secretId, value ),
    secretsClear : ( secretId : string ) : Promise<SecretSaveResult> => ipcRenderer.invoke( IPC.secretsClear, secretId ),

    // dynamodb (the Data tab)
    dynamoTables    : ( service : string ) : Promise<{ tables : Array<DynamoTable>; error? : string }> => ipcRenderer.invoke( IPC.dynamoTables, service ),
    dynamoTableInfo : ( table : string ) : Promise<{ keySchema? : DynamoKeySchema; error? : string }> => ipcRenderer.invoke( IPC.dynamoTableInfo, table ),
    dynamoScan      : ( table : string, startKey? : Record<string, unknown> ) : Promise<DynamoScanResult> => ipcRenderer.invoke( IPC.dynamoScan, table, startKey ),
    dynamoPut       : ( table : string, item : Record<string, unknown> ) : Promise<DynamoSaveResult> => ipcRenderer.invoke( IPC.dynamoPut, table, item ),
    dynamoDelete    : ( table : string, key : Record<string, unknown> ) : Promise<DynamoSaveResult> => ipcRenderer.invoke( IPC.dynamoDelete, table, key ),

    // cognito (the Cognito tab)
    cognitoPools       : ( service : string ) : Promise<{ pools : Array<CognitoPool>; error? : string }> => ipcRenderer.invoke( IPC.cognitoPools, service ),
    cognitoUsers       : ( poolId : string, filter? : string ) : Promise<{ users : Array<CognitoUser>; error? : string }> => ipcRenderer.invoke( IPC.cognitoUsers, poolId, filter ),
    cognitoCreateUser  : ( poolId : string, username : string, attributes : Record<string, string>, tempPassword? : string ) : Promise<CognitoResult> => ipcRenderer.invoke( IPC.cognitoCreateUser, poolId, username, attributes, tempPassword ),
    cognitoUpdateUser  : ( poolId : string, username : string, attributes : Record<string, string> ) : Promise<CognitoResult> => ipcRenderer.invoke( IPC.cognitoUpdateUser, poolId, username, attributes ),
    cognitoSetEnabled  : ( poolId : string, username : string, enabled : boolean ) : Promise<CognitoResult> => ipcRenderer.invoke( IPC.cognitoSetEnabled, poolId, username, enabled ),
    cognitoDeleteUser  : ( poolId : string, username : string ) : Promise<CognitoResult> => ipcRenderer.invoke( IPC.cognitoDeleteUser, poolId, username ),
    cognitoSetPassword : ( poolId : string, username : string, password : string, permanent : boolean ) : Promise<CognitoResult> => ipcRenderer.invoke( IPC.cognitoSetPassword, poolId, username, password, permanent ),

    // api tester (the API tab)
    apiDiscover    : ( service : string ) : Promise<Array<ApiEndpointDef>> => ipcRenderer.invoke( IPC.apiDiscover, service ),
    apiSend        : ( spec : ApiRequestSpec ) : Promise<ApiResponse> => ipcRenderer.invoke( IPC.apiSend, spec ),
    apiSavedList   : ( service : string ) : Promise<Array<SavedRequest>> => ipcRenderer.invoke( IPC.apiSavedList, service ),
    apiSavedSave   : ( service : string, req : SavedRequest ) : Promise<Array<SavedRequest>> => ipcRenderer.invoke( IPC.apiSavedSave, service, req ),
    apiSavedDelete : ( service : string, id : string ) : Promise<Array<SavedRequest>> => ipcRenderer.invoke( IPC.apiSavedDelete, service, id ),

    // cloud monitor (graph / health / logs / S3 / containers / proxy)
    cloudGraph  : () : Promise<CloudGraph> => ipcRenderer.invoke( IPC.cloudGraph ),
    cloudHealth : () : Promise<CloudHealth> => ipcRenderer.invoke( IPC.cloudHealth ),
    cloudTail   : ( logGroup : string, limit? : number ) : Promise<{ events : Array<LogEvent>; error? : string }> => ipcRenderer.invoke( IPC.cloudTail, logGroup, limit ),
    s3List      : ( bucket : string, prefix? : string ) : Promise<S3Listing> => ipcRenderer.invoke( IPC.s3List, bucket, prefix ),
    s3Buckets   : ( match? : string ) : Promise<Array<string>> => ipcRenderer.invoke( IPC.s3Buckets, match ),
    s3Head      : ( bucket : string, key : string ) : Promise<S3ObjectHead> => ipcRenderer.invoke( IPC.s3Head, bucket, key ),
    s3PresignGet : ( bucket : string, key : string, ttlSec? : number ) : Promise<string> => ipcRenderer.invoke( IPC.s3PresignGet, bucket, key, ttlSec ),
    apigwRoutes : ( apiId : string ) : Promise<ApiGwInfo> => ipcRenderer.invoke( IPC.apigwRoutes, apiId ),
    dockerContainers : () : Promise<{ containers : Array<ContainerInfo>; error? : string }> => ipcRenderer.invoke( IPC.dockerContainers ),
    ecsService       : ( serviceArn : string ) : Promise<EcsServiceState> => ipcRenderer.invoke( IPC.ecsService, serviceArn ),
    vpcLinkDiagnose  : () : Promise<VpcLinkDiagnosis> => ipcRenderer.invoke( IPC.vpcLinkDiagnose ),
    webAppUrl        : ( service : string ) : Promise<{ url? : string; error? : string }> => ipcRenderer.invoke( IPC.webAppUrl, service ),
    openExternal     : ( url : string ) : Promise<void> => ipcRenderer.invoke( IPC.openExternal, url ),
    devStart         : ( service : string ) : Promise<void> => ipcRenderer.invoke( IPC.devStart, service ),
    devStop          : ( service : string ) : Promise<void> => ipcRenderer.invoke( IPC.devStop, service ),
    tailDeployedStart : ( service : string ) : Promise<void> => ipcRenderer.invoke( IPC.tailDeployedStart, service ),
    tailDeployedStop  : ( service : string ) : Promise<void> => ipcRenderer.invoke( IPC.tailDeployedStop, service ),
    deployedPorts     : ( service : string ) : Promise<Record<number, number>> => ipcRenderer.invoke( IPC.deployedPorts, service ),
    manifestDrift     : ( service : string ) : Promise<ManifestDrift> => ipcRenderer.invoke( IPC.manifestDrift, service ),
    proxyStart       : ( port? : number ) : Promise<void> => ipcRenderer.invoke( IPC.proxyStart, port ),
    proxyStop        : () : Promise<void> => ipcRenderer.invoke( IPC.proxyStop ),
    proxyRestart     : ( port? : number ) : Promise<void> => ipcRenderer.invoke( IPC.proxyRestart, port ),
    proxyState       : () : Promise<boolean> => ipcRenderer.invoke( IPC.proxyState ),
    proxyConfigList  : () : Promise<Array<string>> => ipcRenderer.invoke( IPC.proxyConfigList ),
    proxyConfigGet   : ( name : string ) : Promise<{ config? : ProxyConfig; error? : string }> => ipcRenderer.invoke( IPC.proxyConfigGet, name ),
    proxyConfigSave  : ( name : string, config : ProxyConfig ) : Promise<{ ok : boolean; error? : string }> => ipcRenderer.invoke( IPC.proxyConfigSave, name, config ),
    proxyApply       : ( config : ProxyConfig ) : Promise<{ ok : boolean; error? : string }> => ipcRenderer.invoke( IPC.proxyApply, config ),
    proxyGatewayTargets : () : Promise<{ prefixes : Record<string, string>; error? : string }> => ipcRenderer.invoke( IPC.proxyGatewayTargets ),
    proxyLocalRoutes : () : Promise<Array<ProxyRoute>> => ipcRenderer.invoke( IPC.proxyLocalRoutes ),

    // repo (git check-out / check-in)
    repoStatus    : () : Promise<RepoStatus> => ipcRenderer.invoke( IPC.repoStatus ),
    repoBranches  : () : Promise<RepoBranches> => ipcRenderer.invoke( IPC.repoBranches ),
    repoPull      : ( branch? : string ) : Promise<number> => ipcRenderer.invoke( IPC.repoPull, branch ),
    repoReinstall : () : Promise<number> => ipcRenderer.invoke( IPC.repoReinstall ),
    repoBump      : ( area : string, kind : BumpKind ) : Promise<{ ok : boolean; version? : string; error? : string }> => ipcRenderer.invoke( IPC.repoBump, area, kind ),
    repoTest      : ( areas : Array<string> ) : Promise<number> => ipcRenderer.invoke( IPC.repoTest, areas ),
    repoCommitPush : ( branch : string, message : string, paths : Array<string> ) : Promise<number> => ipcRenderer.invoke( IPC.repoCommitPush, branch, message, paths ),
    repoCreatePR  : ( branch : string, title : string, paths : Array<string> ) : Promise<number> => ipcRenderer.invoke( IPC.repoCreatePR, branch, title, paths ),
    repoOutdated  : () : Promise<{ deps : Array<NpmOutdated>; error? : string }> => ipcRenderer.invoke( IPC.repoOutdated ),
    repoUpdateDeps : ( names : Array<string> ) : Promise<number> => ipcRenderer.invoke( IPC.repoUpdateDeps, names ),
    repoVersionConflicts : () : Promise<{ conflicts : Array<VersionConflict>; error? : string }> => ipcRenderer.invoke( IPC.repoVersionConflicts ),
    repoSyncVersions : ( names : Array<string> ) : Promise<number> => ipcRenderer.invoke( IPC.repoSyncVersions, names ),
    watchSyncStart   : ( service : string ) : Promise<{ ok : boolean; error? : string }> => ipcRenderer.invoke( IPC.watchSyncStart, service ),
    watchSyncStop    : ( service : string ) : Promise<void> => ipcRenderer.invoke( IPC.watchSyncStop, service ),
    watchSyncState   : ( service : string ) : Promise<boolean> => ipcRenderer.invoke( IPC.watchSyncState, service ),
    buildConfigure   : ( settings : Record<string, BuildSettings> ) : Promise<void> => ipcRenderer.invoke( IPC.buildConfigure, settings ),
    buildQueueGet    : () : Promise<BuildQueue> => ipcRenderer.invoke( IPC.buildQueueGet ),
    buildRunStep     : ( service : string, step : StageId ) : Promise<void> => ipcRenderer.invoke( IPC.buildRunStep, service, step ),
    buildRunNow      : ( service : string ) : Promise<void> => ipcRenderer.invoke( IPC.buildRunNow, service ),
    buildAll         : ( ids : Array<string>, runId? : string ) : Promise<void> => ipcRenderer.invoke( IPC.buildAll, ids, runId ),

    // deploy (git → real AWS environment)
    deployRefs        : () : Promise<{ branches : Array<string>; tags : Array<string>; current : string }> => ipcRenderer.invoke( IPC.deployRefs ),
    deployGitVersions : ( ref : string, services : Array<string> ) : Promise<Record<string, string>> => ipcRenderer.invoke( IPC.deployGitVersions, ref, services ),
    deployedVersions  : ( config : DeployEnvConfig ) : Promise<{ deployed : Record<string, string>; error? : string }> => ipcRenderer.invoke( IPC.deployedVersions, config ),
    deployRun         : ( req : DeployRequest ) : Promise<DeployResult> => ipcRenderer.invoke( IPC.deployRun, req ),
    deployMap         : ( configs : Record<DeployEnvName, DeployEnvConfig> ) : Promise<DeployMap> => ipcRenderer.invoke( IPC.deployMap, configs ),
    deployState       : () : Promise<DeployState> => ipcRenderer.invoke( IPC.deployState ),
    deployAudit       : ( limit? : number ) : Promise<Array<AuditEntry>> => ipcRenderer.invoke( IPC.deployAudit, limit ),
    deployProposeTag  : ( ref : string ) : Promise<string | undefined> => ipcRenderer.invoke( IPC.deployProposeTag, ref ),
    deployOpenLine    : () : Promise<{ ok : boolean; line? : string; error? : string }> => ipcRenderer.invoke( IPC.deployOpenLine ),

    // in-app browser window (console captured to the Trace view)
    browserOpen       : ( url : string ) : Promise<{ ok : boolean; url : string }> => ipcRenderer.invoke( IPC.browserOpen, url ),
    browserClose      : () : Promise<void> => ipcRenderer.invoke( IPC.browserClose ),
    browserReload     : () : Promise<void> => ipcRenderer.invoke( IPC.browserReload ),
    browserBack       : () : Promise<void> => ipcRenderer.invoke( IPC.browserBack ),
    browserForward    : () : Promise<void> => ipcRenderer.invoke( IPC.browserForward ),
    browserResize     : ( width : number, height : number ) : Promise<void> => ipcRenderer.invoke( IPC.browserResize, width, height ),
    browserState      : () : Promise<BrowserState> => ipcRenderer.invoke( IPC.browserState ),

    // ses viewer (Email sub-tab)
    sesMessages      : () : Promise<SesListing> => ipcRenderer.invoke( IPC.sesMessages ),
    sesClear         : () : Promise<void> => ipcRenderer.invoke( IPC.sesClear ),

    // fake providers (Fake → Email)
    fakeInbox        : () : Promise<FakeEmailListing> => ipcRenderer.invoke( IPC.fakeInbox ),
    fakeClear        : () : Promise<void> => ipcRenderer.invoke( IPC.fakeClear ),
    fakeConfigGet    : () : Promise<FakeEmailConfigResult> => ipcRenderer.invoke( IPC.fakeConfigGet ),
    fakeConfigSave   : ( config : unknown ) : Promise<FakeEmailSaveResult> => ipcRenderer.invoke( IPC.fakeConfigSave, config ),
    // auth actions (Actions tab)
    authActionsList   : ( status : string ) : Promise<AuthActionsListing> => ipcRenderer.invoke( IPC.authActionsList, status ),
    authActionsCancel : ( actionId : string ) : Promise<AuthActionCancelResult> => ipcRenderer.invoke( IPC.authActionsCancel, actionId ),
    cognitoCodes     : () : Promise<CognitoCodeListing> => ipcRenderer.invoke( IPC.cognitoCodes ),

    // kafka monitor (Events sub-tab)
    monitorStart     : () : Promise<MonitorState> => ipcRenderer.invoke( IPC.monitorStart ),
    monitorStop      : () : Promise<void> => ipcRenderer.invoke( IPC.monitorStop ),
    monitorState     : () : Promise<MonitorState> => ipcRenderer.invoke( IPC.monitorState ),
    monitorSetTtl    : ( ms : number ) : Promise<void> => ipcRenderer.invoke( IPC.monitorSetTtl, ms ),
    monitorClear     : () : Promise<void> => ipcRenderer.invoke( IPC.monitorClear ),

    // process monitor (Processes sub-tab)
    processList      : () : Promise<ProcessListing> => ipcRenderer.invoke( IPC.processList ),
    processKill      : ( pid : number ) : Promise<void> => ipcRenderer.invoke( IPC.processKill, pid ),
    processReap      : () : Promise<ReapResult> => ipcRenderer.invoke( IPC.processReap ),

    // live events
    onShuttingDown   : ( h : () => void ) : () => void => on( IPC.onShuttingDown, () => h() ),
    onLog            : ( h : ( line : LogLine ) => void ) : () => void => on( IPC.onLog, h ),
    onProc           : ( h : ( state : ProcState ) => void ) : () => void => on( IPC.onProc, h ),
    onStage          : ( h : ( payload : { service : string; state : StageState } ) => void ) : () => void => on( IPC.onStage, h ),
    onLocalStack     : ( h : ( state : LocalStackState ) => void ) : () => void => on( IPC.onLocalStack, h ),
    onClaudeMessage  : ( h : ( msg : ClaudeMessage ) => void ) : () => void => on( IPC.onClaudeMessage, h ),
    onClaudeApproval : ( h : ( req : ClaudeApprovalRequest ) => void ) : () => void => on( IPC.onClaudeApproval, h ),
    onClaudeState    : ( h : ( state : ClaudeSessionState ) => void ) : () => void => on( IPC.onClaudeState, h ),
    onBrowser        : ( h : ( s : BrowserState ) => void ) : () => void => on( IPC.onBrowser, h ),
    onBuildQueue     : ( h : ( q : BuildQueue ) => void ) : () => void => on( IPC.onBuildQueue, h ),
    onMonitorEvent   : ( h : ( e : MonitorEvent ) => void ) : () => void => on( IPC.onMonitorEvent, h ),
    onMonitorSync    : ( h : ( s : MonitorSync ) => void ) : () => void => on( IPC.onMonitorSync, h )
};

export type ConsoleApi = typeof api;

contextBridge.exposeInMainWorld( "api", api );
