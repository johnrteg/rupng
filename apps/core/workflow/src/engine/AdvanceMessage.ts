//
//
// AdvanceMessage — the shape carried on BOTH the `workflow-advance` and `workflow-scheduler-wake`
// queues. Correlates a step to the exact (instance, node) it belongs to (README.md "resume key =
// instanceId + nodePath") — the instance alone isn't enough; a definition has many nodes, so the
// consumer must know WHICH node this tick is for, to (a) execute the right step and (b) detect a
// stale/duplicate message (the instance's `currentNodeId` has since moved past `nodeId`).
//
// `signal` is absent for a normal first-visit advance; `"timeout"` when WorkflowSchedulerJob is waking
// a parked `sleep`/`wait_for_response` node; `"resume"` when WorkflowTriggerConsumer resolved an
// external inbound signal (e.g. a contact's reply) to a `wait_for_response` node's `waitKey`.
//
export interface AdvanceMessage
{
    accountId:  string;
    instanceId: string;
    nodeId:     string;
    signal?:    "resume" | "timeout";
}

export default AdvanceMessage;
// eof
