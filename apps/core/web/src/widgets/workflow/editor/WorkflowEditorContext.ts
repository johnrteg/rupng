//
import React from "react";

import { WorkflowEditorState, WorkflowEditorAction, makeInitialState } from "./WorkflowEditorModel";

//
// WorkflowEditorContext — the React context that shares the editor's reducer state + dispatch across
// the editor tree (mirrors SvgEditorContext). WorkflowEditor owns the useReducer and provides the
// value; the palette/canvas/inspector/toolbar each read `{ state, dispatch } =
// React.useContext( WorkflowEditorContext )` instead of prop-drilling.
//

/** The value carried by {@link WorkflowEditorContext}. */
export interface WorkflowEditorContextValue
{
    readonly state    : WorkflowEditorState;
    readonly dispatch : React.Dispatch<WorkflowEditorAction>;
}

/** The shared editor context. Default dispatch is a no-op so a stray read outside the provider is inert. */
export const WorkflowEditorContext : React.Context<WorkflowEditorContextValue> = React.createContext<WorkflowEditorContextValue>( {
    state: makeInitialState(),
    dispatch: () : void => { /* no-op until a provider supplies the real dispatch */ },
} );

export default WorkflowEditorContext;
