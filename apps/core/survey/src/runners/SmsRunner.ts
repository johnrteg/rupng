//
import { randomUUID } from "node:crypto";

import { Survey, Question } from "@repo/api";
import type { Type } from "@repo/common";

//
// SmsRunner — compiles a channel-agnostic Survey definition to workflow primitives (survey-2.1). SMS is the
// ONE runner that goes through workflow (survey-9.6) — a conversational survey IS a workflow of
// `collect-input`/`classify-reply`/`switch`/`update-contact` steps, generated here rather than reimplementing
// two-way capture. `apps/core/workflow` has no `package.json` yet — it's a spec + typed model only
// (`apps/core/workflow/src/WorkflowModel.ts`), not a resolvable workspace package survey can import — so the
// shapes below are a LOCAL MIRROR of that model's node/edge/config interfaces, kept intentionally minimal.
// Reconcile this against the real `Workflow.Definition` type once workflow ships a shared `@repo/api` contract
// (this compiler emits the JSON shape; it can't yet be executed until workflow's own runtime lands — see the
// implementation plan's Phase 5 dependency note).
//
export namespace SmsRunner
{
    /** Mirrors `WorkflowModel.NodeKind` (the subset this compiler emits). */
    export enum NodeKind { COLLECT_INPUT = "collect-input", CLASSIFY_REPLY = "classify-reply", SWITCH = "switch", UPDATE_CONTACT = "update-contact" }

    export interface CollectInputConfig  { prompt : string; varName : string; timeout : { minutes : number }; maxAttempts? : number; }
    export interface ClassifyReplyConfig { mode : "keyword"; keywords : Record<string, Array<string>>; }
    export interface SwitchCase          { label : string; whenExpr : string; }
    export interface SwitchConfig        { expression : string; cases : Array<SwitchCase>; }
    export interface UpdateContactConfig { set? : Record<string, string>; addTags? : Array<string>; }

    export type NodeConfig = CollectInputConfig | ClassifyReplyConfig | SwitchConfig | UpdateContactConfig;

    export interface Node { id : Type.UUID; kind : NodeKind; config : NodeConfig; }
    export interface Edge { fromNodeId : Type.UUID; toNodeId : Type.UUID; whenCase? : string; }

    /** A compiled fragment — nodes/edges to splice into a Survey distribution's workflow run, plus the entry
     *  node the distribution job hands to workflow when it starts the conversation. */
    export interface CompiledDefinition
    {
        nodes    : Array<Node>;
        edges    : Array<Edge>;
        startNodeId : Type.UUID;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Compile a Survey definition into workflow steps: one `collect-input` per question (in `order`), a
     *  `classify-reply` + `switch` pair per branching question (survey-1.1's `Question.Branch`), and an
     *  `update-contact` step per scoring config (landing the computed score/tag — survey-4.2). Falls through
     *  to the next question in order when a question has no matching branch. */
    export function compile( survey : Survey.Entity ) : CompiledDefinition
    {
        const ordered : Array<Question.Entity> = [ ...survey.questions ].sort( ( first : Question.Entity, second : Question.Entity ) : number => first.order - second.order );
        const nodes : Array<Node> = [];
        const edges : Array<Edge> = [];

        // one collect-input per question, chained in order; a branching question gets a classify-reply +
        // switch pair immediately after its collect-input, overriding the default straight-through edge.
        const nodeIdByQuestion : Record<string, string> = {};
        for( const question of ordered ) nodeIdByQuestion[ question.id ] = randomUUID();

        ordered.forEach( ( question : Question.Entity, index : number ) : void =>
        {
            const nodeId : Type.UUID = nodeIdByQuestion[ question.id ];
            nodes.push( { id: nodeId, kind: NodeKind.COLLECT_INPUT, config: { prompt: question.prompt, varName: question.id, timeout: { minutes: 60 }, maxAttempts: 3 } } );

            const next : Question.Entity | undefined = ordered[ index + 1 ];
            if( question.branches?.length )
            {
                // classify-reply matches the raw SMS keyword to a choice/whenValue, then switch dispatches
                const classifyId : Type.UUID = randomUUID();
                const switchId   : Type.UUID = randomUUID();
                nodes.push( { id: classifyId, kind: NodeKind.CLASSIFY_REPLY, config: { mode: "keyword", keywords: Object.fromEntries( question.branches.map( ( branch ) => [ branch.whenValue, [ branch.whenValue ] ] ) ) } } );
                nodes.push( { id: switchId, kind: NodeKind.SWITCH, config: { expression: `answers.${ question.id }`, cases: question.branches.map( ( branch ) => ( { label: branch.whenValue, whenExpr: `== "${ branch.whenValue }"` } ) ) } } );
                edges.push( { fromNodeId: nodeId, toNodeId: classifyId } );
                edges.push( { fromNodeId: classifyId, toNodeId: switchId } );
                question.branches.forEach( ( branch ) : void =>
                {
                    edges.push( { fromNodeId: switchId, toNodeId: nodeIdByQuestion[ branch.nextQuestionId ], whenCase: branch.whenValue } );
                } );
                // fall-through when no branch matched
                if( next ) edges.push( { fromNodeId: switchId, toNodeId: nodeIdByQuestion[ next.id ], whenCase: undefined } );
            }
            else if( next )
            {
                edges.push( { fromNodeId: nodeId, toNodeId: nodeIdByQuestion[ next.id ] } );
            }
        } );

        // one update-contact step per scoring config, appended after the last question — lands the score
        // (and an NPS bucket tag, when configured) on the contact (survey-4.2)
        const lastQuestion : Question.Entity | undefined = ordered[ ordered.length - 1 ];
        let previousId : Type.UUID | undefined = lastQuestion ? nodeIdByQuestion[ lastQuestion.id ] : undefined;
        for( const config of survey.scoring ?? [] )
        {
            const updateId : Type.UUID = randomUUID();
            nodes.push( { id: updateId, kind: NodeKind.UPDATE_CONTACT, config: {
                set:     config.contactFieldUid ? { [ config.contactFieldUid ]: `score(${ config.questionId })` } : undefined,
                addTags: config.tagOnBucket ? [ `survey:${ config.scoreType }:{{bucket}}` ] : undefined,
            } } );
            if( previousId ) edges.push( { fromNodeId: previousId, toNodeId: updateId } );
            previousId = updateId;
        }

        return { nodes, edges, startNodeId: nodes[ 0 ]?.id ?? randomUUID() };
    }
}

export default SmsRunner;
// eof
