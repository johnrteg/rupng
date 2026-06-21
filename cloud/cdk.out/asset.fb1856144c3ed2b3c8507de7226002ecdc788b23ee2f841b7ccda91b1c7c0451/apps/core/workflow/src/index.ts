//
// The engine-agnostic CORE of the workflow service: the definition schema, the node catalog +
// node contract, and the durable Engine port. The deployable roles (trigger router, step worker,
// API, scheduler) live alongside this in apps/core/workflow and build on it. See SPECS.md + README.md.
//
export { Workflow, default } from "./WorkflowModel";
