import { JSX } from "react";

import { Access } from "@repo/system";

import AuthPage from "@widgets/app/AuthPage";
import { MonitorDashboardGrid } from "@widgets/monitor/MonitorDashboardGrid";

//
// Monitor : Dashboard — the operational-health view: a configurable grid of widgets over
// DynamoDB tables, SQS queues, ECS services, Lambda jobs, and API call metrics. Staff-only
// (platform-wide operational data, not account-scoped). Widget configuration lives in the ops
// Console's Config editor, not here — see CLAUDE.md's Config-model rules.
//
export function MonitorDashboard() : JSX.Element
{
    return (
        <AuthPage minAccess={ Access.AppRole.SUPPORT } title={ "Monitor" }>
            <MonitorDashboardGrid />
        </AuthPage>
    );
}

export namespace MonitorDashboard
{
    export interface Props {}
}

export default MonitorDashboard;
// eof
