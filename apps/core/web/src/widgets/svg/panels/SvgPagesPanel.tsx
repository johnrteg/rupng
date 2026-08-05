//
import React from "react";
import { JSX } from "react";

import { Box, Button, Stack, TextField, Typography } from "@mui/material";
import AddOutlinedIcon      from "@mui/icons-material/AddOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";

import { SvgDocument } from "@repo/api";

import ButtonIcon from "@widgets/core/ButtonIcon";
import Pusher from "@widgets/core/Pusher";
import { SvgEditorContext, SvgEditorContextValue } from "@widgets/svg/editor/SvgEditorContext";
import { SvgEditorActionType, makeBlankLayer, makeId, DEFAULT_PAGE_SIZE, ptToUnit } from "@widgets/svg/editor/SvgEditorModel";

//
// Human-readable short labels for named presets — used in the footer size indicator.
//
const PRESET_SHORT_LABEL : Partial<Record<SvgDocument.PagePreset, string>> =
{
    [ SvgDocument.PagePreset.LETTER ]        : "Letter",
    [ SvgDocument.PagePreset.LEGAL ]         : "Legal",
    [ SvgDocument.PagePreset.TABLOID ]       : "Tabloid",
    [ SvgDocument.PagePreset.A4 ]            : "A4",
    [ SvgDocument.PagePreset.A5 ]            : "A5",
    [ SvgDocument.PagePreset.POSTCARD_4X6 ]  : "Postcard 4×6",
    [ SvgDocument.PagePreset.RACK_CARD ]     : "Rack Card",
    [ SvgDocument.PagePreset.DOOR_HANGER ]   : "Door Hanger",
    [ SvgDocument.PagePreset.BUSINESS_CARD ] : "Business Card",
    [ SvgDocument.PagePreset.SOCIAL_1X1 ]    : "Square 1:1",
    [ SvgDocument.PagePreset.SOCIAL_16X9 ]   : "16:9",
    [ SvgDocument.PagePreset.SOCIAL_9X16 ]   : "9:16",
};

// Build a short human-readable label for the document's page size shown in the footer.
function pageSizeLabel( size : SvgDocument.PageSize ) : string
{
    const preset : string = size.preset !== null
        ? ( PRESET_SHORT_LABEL[ size.preset ] ?? "Custom" )
        : `${ Math.round( ptToUnit( size.width, size.unit, size.dpi ) * 10 ) / 10 } × ${ Math.round( ptToUnit( size.height, size.unit, size.dpi ) * 10 ) / 10 } ${ size.unit }`;
    const orientation : string = size.width >= size.height ? "Landscape" : "Portrait";
    return `${ preset }  ·  ${ orientation }  ·  ${ size.dpi } dpi`;
}

//
// SvgPagesPanel — the bottom footer strip. Left side: compact page chips (rename inline on double-click)
// and an Add Page button. Right side: the document's page size / orientation / DPI label (doc-wide, not
// per-page) and a gear icon that opens Document Settings.
//
export function SvgPagesPanel( props : SvgPagesPanel.Props ) : JSX.Element
{
    const editor : SvgEditorContextValue = React.useContext( SvgEditorContext );
    const [ editingPageId, setEditingPageId ] = React.useState<string | null>( null );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // rename a page by patching its name in the doc and committing (snapshots for undo)
    function renamePage( pageId : string, name : string ) : void
    {
        if( editor.state.doc === null ) return;
        const pages : Array<SvgDocument.Page> = editor.state.doc.pages.map(
            ( candidate : SvgDocument.Page ) : SvgDocument.Page =>
                candidate.id === pageId ? { ...candidate, name } : candidate
        );
        editor.dispatch( { type: SvgEditorActionType.SET_DOC, doc: { ...editor.state.doc, pages } } );
        setEditingPageId( null );
    }

    function onPageNameKeyDown( event : React.KeyboardEvent<HTMLInputElement>, pageId : string ) : void
    {
        if( event.key === "Enter"  ) renamePage( pageId, ( event.target as HTMLInputElement ).value );
        if( event.key === "Escape" ) setEditingPageId( null );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // add a new page — inherits the document's page size, orientation, and background from the current page
    function onAddPage() : void
    {
        const layer : SvgDocument.Layer = makeBlankLayer();
        const newPage : SvgDocument.Page =
        {
            ...props.page,
            id     : makeId(),
            name   : `Page ${ props.doc.pages.length + 1 }`,
            layers : [ layer ],
            guides : [],
            grid   : null,
        };
        editor.dispatch( { type: SvgEditorActionType.ADD_PAGE, page: newPage } );
        setEditingPageId( newPage.id );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // one compact page chip — highlighted when active; double-click name to rename inline
    function pageChip( page : SvgDocument.Page ) : JSX.Element
    {
        const isActive  : boolean = editor.state.activePage === page.id;
        const isEditing : boolean = editingPageId === page.id;
        const chipSx = {
            px: 1.25, height: 32, display: "flex", alignItems: "center",
            border: isActive ? 2 : 1, borderRadius: 1, cursor: "pointer", flexShrink: 0,
            borderColor: isActive ? "primary.main" : "divider",
            bgcolor: isActive ? "action.selected" : "transparent",
            userSelect: "none",
        };
        return  <Box key={ page.id } sx={ chipSx }
                     onClick={ () : void => editor.dispatch( { type: SvgEditorActionType.SET_ACTIVE_PAGE, pageId: page.id } ) }>
                    { isEditing
                        ? <TextField size="small" autoFocus defaultValue={ page.name }
                                     variant="standard" sx={{ width: 72 }}
                                     onClick={ ( event : React.MouseEvent<HTMLDivElement> ) : void => event.stopPropagation() }
                                     onBlur={ ( event : React.FocusEvent<HTMLInputElement> ) : void => renamePage( page.id, event.target.value ) }
                                     onKeyDown={ ( event : React.KeyboardEvent<HTMLInputElement> ) : void => onPageNameKeyDown( event, page.id ) } />
                        : <Typography variant="caption" noWrap
                                      onDoubleClick={ () : void => setEditingPageId( page.id ) }>
                              { page.name }
                          </Typography> }
                </Box>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // resolve the document-level page size (doc.pageSize is canonical; fall back for older docs)
    const docSize : SvgDocument.PageSize = props.doc.pageSize ?? props.doc.pages[ 0 ]?.size ?? DEFAULT_PAGE_SIZE;

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <Stack direction="row" spacing={ 0 }
                   sx={{ height: 44, borderTop: 1, borderColor: "divider", bgcolor: "background.paper", alignItems: "center" }}>

                { /* ── Page chips + Add Page ───────────────────────────────────── */ }
                <Stack direction="row" spacing={ 0.75 } sx={{ px: 1.5, py: 0.5, overflowX: "auto", alignItems: "center", flexShrink: 1, minWidth: 0 }}>
                    { props.doc.pages.map( ( page : SvgDocument.Page ) : JSX.Element => pageChip( page ) ) }
                    <Button size="small" startIcon={ <AddOutlinedIcon fontSize="small" /> } onClick={ onAddPage }
                            sx={{ whiteSpace: "nowrap", flexShrink: 0 }}>
                        {"Add Page"}
                    </Button>
                </Stack>

                <Pusher />

                { /* ── Document page size label + settings gear ───────────────── */ }
                <Stack direction="row" spacing={ 0.5 } sx={{ px: 1.5, alignItems: "center", flexShrink: 0 }}>
                    <Typography variant="caption" sx={{ color: "text.secondary", whiteSpace: "nowrap" }}>
                        { pageSizeLabel( docSize ) }
                    </Typography>
                    <ButtonIcon id="svg-doc-settings" label={"Document settings"} size="small"
                                icon={ <SettingsOutlinedIcon fontSize="small" /> }
                                onClick={ props.onOpenSettings } />
                </Stack>

            </Stack>;
}

export namespace SvgPagesPanel
{
    export interface Props
    {
        doc            : SvgDocument.Doc;
        page           : SvgDocument.Page;
        onOpenSettings : () => void;
    }
}

export default SvgPagesPanel;
