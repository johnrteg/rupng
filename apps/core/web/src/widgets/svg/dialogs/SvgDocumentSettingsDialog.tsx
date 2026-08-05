//
import React from "react";
import { JSX } from "react";

import { SvgDocument } from "@repo/api";

import DialogWindow from "@widgets/core/DialogWindow";
import { SvgEditorContext, SvgEditorContextValue } from "@widgets/svg/editor/SvgEditorContext";
import PageInspector from "@widgets/svg/inspector/PageInspector";

//
// SvgDocumentSettingsDialog — document-level settings: page size, orientation, and resolution.
// Changes apply immediately to the document (ALL pages) and are added to undo history.
// Opened from the gear icon in the pages footer strip.
//
export function SvgDocumentSettingsDialog( props : SvgDocumentSettingsDialog.Props ) : JSX.Element
{
    const editor : SvgEditorContextValue = React.useContext( SvgEditorContext );
    const doc : SvgDocument.Doc | null = editor.state.doc;

    if( !props.open || doc === null ) return <></>;

    /////////////////////////////////////////////////////////////////////////////
    // changes apply immediately via editor context dispatch; Done just closes
    async function onDone() : Promise<boolean>
    {
        return true;
    }

    return  <DialogWindow   id="svg-document-settings"
                            minWidth="xs"
                            title={"Document Settings"}
                            yesLabel={"Done"}
                            onYes={ onDone }
                            onClose={ props.onClose } >
                <PageInspector doc={ doc } />
            </DialogWindow>;
}

export namespace SvgDocumentSettingsDialog
{
    export interface Props
    {
        open    : boolean;
        onClose : () => void;
    }
}

export default SvgDocumentSettingsDialog;
