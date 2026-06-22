//
// @repo/workflow — the engine-agnostic CORE of the workflow service: the definition schema,
// the node catalog + node contract, and the durable Engine port. The deployed service
// (trigger router, worker, API, visualization) lives in apps/core/workflow and imports this.
// See README.md.
//
export { Workflow, default } from "./WorkflowModel";
