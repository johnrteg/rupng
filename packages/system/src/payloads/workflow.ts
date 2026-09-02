//
// Workflow service payloads
//
import type { Type } from "@repo/common";

/** A workflow definition — the `workflow.workflow` entity representation. */
export interface Workflow
{
    id:        Type.ID;
    accountId: Type.ID;
    name:      string;
    status:    string;
    version:   number;
}

/** A workflow instance (run) — the `workflow.instance` entity representation. */
export interface WorkflowInstance
{
    instanceId:   Type.ID;
    accountId:    Type.ID;
    definitionId: Type.ID;
    status:       string;
}
