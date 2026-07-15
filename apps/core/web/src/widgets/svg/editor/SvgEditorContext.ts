//
import React from "react";

import { SvgEditorState, SvgEditorAction, makeInitialState } from "./SvgEditorModel";

//
// SvgEditorContext — the React context that shares the editor's reducer state + dispatch across the editor
// tree. SvgDesignEditor owns the useReducer and provides the value; every panel/inspector/toolbar/canvas
// child reads `{ state, dispatch } = React.useContext( SvgEditorContext )` instead of prop-drilling. This
// replaces the (unused) external store — the whole editor lives under one component, so built-in
// reducer+context is sufficient and dependency-free.
//

/** The value carried by {@link SvgEditorContext}. */
export interface SvgEditorContextValue
{
    readonly state    : SvgEditorState;
    readonly dispatch : React.Dispatch<SvgEditorAction>;
}

/** The shared editor context. Default dispatch is a no-op so a stray read outside the provider is inert. */
export const SvgEditorContext : React.Context<SvgEditorContextValue> = React.createContext<SvgEditorContextValue>( {
    state: makeInitialState(),
    dispatch: () : void => { /* no-op until a provider supplies the real dispatch */ },
} );

export default SvgEditorContext;
