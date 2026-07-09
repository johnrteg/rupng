import { JSX } from "react";

import { Box, Button, Chip, CircularProgress, Divider, Stack, Typography } from "@mui/material";
import AddOutlinedIcon           from '@mui/icons-material/AddOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import ImageOutlinedIcon         from '@mui/icons-material/ImageOutlined';

import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';

import { EmailTemplate } from '@repo/api';

import ButtonIcon from '@widgets/core/ButtonIcon';
import TextInput  from '@widgets/core/TextInput';
import SelectInput from '@widgets/core/SelectInput';
import SwitchInput from '@widgets/core/SwitchInput';
import CodeEditorInput from '@widgets/core/CodeEditorInput';
import ColorPicker from '@widgets/core/ColorPicker';
import RichTextEditor from '@widgets/app/rte/RichTextEditor';
import SortableSocialRow from '@widgets/email/editor/SortableSocialRow';
import { standardAttrs, EMAIL_COLORS, ALIGN_CHOICES, VALIGN_CHOICES, HERO_MODE_CHOICES, IMAGE_VARIANTS, DEFAULT_IMAGE_VARIANT } from '@widgets/email/editor/EmailEditorModel';

//
// EmailBlockInspector — the right-pane property editor for the SELECTED block (band / column / content). Renders
// the type-appropriate fields (text RTE, image reference + variant, button, colors, …), a SOCIAL network-list
// editor, and a generic MJML-attributes panel. Controlled: the host owns the doc + does the writes via the typed
// callbacks (patch props / attrs, choose an image, change the image variant, edit social elements).
//
export function EmailBlockInspector( props : EmailBlockInspector.Props ) : JSX.Element
{
    const block : EmailTemplate.Block = props.block;
    const readOnly : boolean = props.readOnly === true;
    const isBand : boolean = block.type === EmailTemplate.BlockType.SECTION || block.type === EmailTemplate.BlockType.HERO || block.type === EmailTemplate.BlockType.WRAPPER;

    return <Stack spacing={ 2 } sx={{ p: 2 }}>
        <Chip size="small" label={ block.type } sx={{ alignSelf: "flex-start" }} />

        {/* ── band (section / hero / wrapper) ── */}
        { isBand && <>
            { backgroundControl( block, readOnly, props ) }
            <ColorPicker id="tpl-bg-color" label={"Background color"} value={ String( block.props?.backgroundColor ?? "" ) } choices={ EMAIL_COLORS } disabled={ readOnly } onChange={ ( color : string ) : void => props.onPatchProps( { backgroundColor: color } ) } onClear={ () : void => props.onPatchProps( { backgroundColor: "" } ) } />
            { block.type === EmailTemplate.BlockType.HERO && <>
                <SelectInput id="tpl-hero-mode" label={"Height mode"} value={ String( block.props?.mode ?? "fluid-height" ) } choices={ HERO_MODE_CHOICES } disabled={ readOnly } onChange={ ( value : string ) : void => props.onPatchProps( { mode: value } ) } />
                <TextInput id="tpl-hero-height" label={"Height (e.g. 300px)"} value={ String( block.props?.height ?? "" ) } fullWidth disabled={ readOnly } onChange={ ( value : string ) : void => props.onPatchProps( { height: value } ) } />
            </> }
            <TextInput id="tpl-band-padding" label={"Padding (e.g. 20px 0)"} value={ String( block.props?.padding ?? "" ) } fullWidth disabled={ readOnly } onChange={ ( value : string ) : void => props.onPatchProps( { padding: value } ) } />
            { ( block.type === EmailTemplate.BlockType.SECTION || block.type === EmailTemplate.BlockType.WRAPPER ) &&
                <SwitchInput id="tpl-band-fullwidth" label={"Full width"} color="success" value={ block.props?.fullWidth === true } disabled={ readOnly } onChange={ ( value : boolean ) : void => props.onPatchProps( { fullWidth: value } ) } /> }
        </> }

        {/* ── column ── */}
        { block.type === EmailTemplate.BlockType.COLUMN && <>
            { backgroundControl( block, readOnly, props ) }
            <TextInput id="tpl-col-width" label={"Width (e.g. 50% or 200px)"} value={ String( block.props?.width ?? "" ) } fullWidth disabled={ readOnly } onChange={ ( value : string ) : void => props.onPatchProps( { width: value } ) } />
            <ColorPicker id="tpl-col-bg" label={"Background color"} value={ String( block.props?.backgroundColor ?? "" ) } choices={ EMAIL_COLORS } disabled={ readOnly } onChange={ ( color : string ) : void => props.onPatchProps( { backgroundColor: color } ) } onClear={ () : void => props.onPatchProps( { backgroundColor: "" } ) } />
            <SelectInput id="tpl-col-valign" label={"Vertical align"} value={ String( block.props?.verticalAlign ?? "top" ) } choices={ VALIGN_CHOICES } disabled={ readOnly } onChange={ ( value : string ) : void => props.onPatchProps( { verticalAlign: value } ) } />
        </> }

        {/* ── text ── */}
        { block.type === EmailTemplate.BlockType.TEXT && <>
            <RichTextEditor key={ block.id } id={ `tpl-text-${ block.id }` } value={ String( block.props?.html ?? "" ) } editable={ !readOnly } minHeight={ 180 }
                            insertTags={ EmailTemplate.MERGE_FIELDS.map( ( field : EmailTemplate.MergeField ) : RichTextEditor.InsertTag => ( { value: `{{${ field.token }}}`, label: `${ field.group } · ${ field.label }` } ) ) }
                            onChange={ ( html : string ) : void => props.onPatchProps( { html } ) } />
            <SelectInput id="tpl-text-align" label={"Align"} value={ String( block.props?.align ?? "left" ) } choices={ ALIGN_CHOICES } disabled={ readOnly } onChange={ ( value : string ) : void => props.onPatchProps( { align: value } ) } />
        </> }

        {/* ── image (a LIBRARY REFERENCE — pick the item + which variant/rendition to use) ── */}
        { block.type === EmailTemplate.BlockType.IMAGE && <>
            {/* preview OR a pending placeholder while the media service is still deriving this variant */}
            { props.imgPending
                ? <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", height: 120, justifyContent: "center", border: 1, borderColor: "divider", borderRadius: 1, color: "text.disabled" }}>
                      <ImageOutlinedIcon /><CircularProgress size={ 16 } /><Typography variant="caption">{"Processing…"}</Typography>
                  </Stack>
                : String( block.props?.src ?? "" ) !== ""
                    ? <Box component="img" src={ String( block.props?.src ) } alt="" sx={{ maxWidth: "100%", maxHeight: 160, borderRadius: 1, border: 1, borderColor: "divider" }} />
                    : <Stack sx={{ alignItems: "center", height: 120, justifyContent: "center", border: 1, borderColor: "divider", borderRadius: 1, color: "text.disabled" }}><ImageOutlinedIcon /></Stack> }
            { String( block.props?.assetName ?? "" ) !== "" &&
                <Typography variant="body2" noWrap sx={{ color: "text.secondary" }}>{ String( block.props?.assetName ) }</Typography> }
            <Button variant="outlined" disabled={ readOnly } onClick={ () => props.onChooseImage( "src" ) }>{ String( block.props?.assetGuid ?? "" ) !== "" ? "Change image" : "Choose image" }</Button>
            { String( block.props?.assetGuid ?? "" ) !== "" &&
                <SelectInput id="tpl-img-variant" label={"Variant"} value={ String( block.props?.variant ?? DEFAULT_IMAGE_VARIANT ) } choices={ IMAGE_VARIANTS } disabled={ readOnly } onChange={ ( value : string ) : void => props.onChangeVariant( value ) } /> }
            <TextInput id="tpl-img-alt" label={"Alt text"} value={ String( block.props?.alt ?? "" ) } fullWidth disabled={ readOnly } onChange={ ( value : string ) : void => props.onPatchProps( { alt: value } ) } />
            <TextInput id="tpl-img-href" label={"Link (href)"} value={ String( block.props?.href ?? "" ) } fullWidth disabled={ readOnly } onChange={ ( value : string ) : void => props.onPatchProps( { href: value } ) } />
        </> }

        {/* ── button ── */}
        { block.type === EmailTemplate.BlockType.BUTTON && <>
            <TextInput id="tpl-btn-text" label={"Label"} value={ String( block.props?.text ?? "" ) } fullWidth disabled={ readOnly } onChange={ ( value : string ) : void => props.onPatchProps( { text: value } ) } />
            <TextInput id="tpl-btn-href" label={"Link (href)"} value={ String( block.props?.href ?? "" ) } fullWidth disabled={ readOnly } onChange={ ( value : string ) : void => props.onPatchProps( { href: value } ) } />
            <ColorPicker id="tpl-btn-bg" label={"Background color"} value={ String( block.props?.background ?? "#2563eb" ) } choices={ EMAIL_COLORS } disabled={ readOnly } onChange={ ( color : string ) : void => props.onPatchProps( { background: color } ) } />
            <ColorPicker id="tpl-btn-color" label={"Text color"} value={ String( block.props?.color ?? "#ffffff" ) } choices={ EMAIL_COLORS } disabled={ readOnly } onChange={ ( color : string ) : void => props.onPatchProps( { color: color } ) } />
        </> }

        {/* ── spacer ── */}
        { block.type === EmailTemplate.BlockType.SPACER &&
            <TextInput id="tpl-spacer" label={"Height (e.g. 20px)"} value={ String( block.props?.height ?? "20px" ) } fullWidth disabled={ readOnly } onChange={ ( value : string ) : void => props.onPatchProps( { height: value } ) } /> }

        {/* ── divider ── */}
        { block.type === EmailTemplate.BlockType.DIVIDER &&
            <ColorPicker id="tpl-div-color" label={"Line color"} value={ String( block.props?.borderColor ?? "#e5e7eb" ) } choices={ EMAIL_COLORS } disabled={ readOnly } onChange={ ( color : string ) : void => props.onPatchProps( { borderColor: color } ) } /> }

        {/* ── table / raw HTML (raw markup) ── */}
        { ( block.type === EmailTemplate.BlockType.TABLE || block.type === EmailTemplate.BlockType.HTML ) &&
            <CodeEditorInput id={ `tpl-code-${ block.id }` } label={ block.type === EmailTemplate.BlockType.TABLE ? "Table rows (HTML)" : "Raw HTML" } value={ String( block.props?.html ?? "" ) } editable={ !readOnly } format="html" onChange={ ( html : string ) : void => props.onPatchProps( { html } ) } /> }

        {/* ── social (edit its network elements) ── */}
        { block.type === EmailTemplate.BlockType.SOCIAL && socialElements( block, readOnly, props ) }

        {/* generic attributes — any MJML attribute for this block */}
        { attributesPanel( block, readOnly, props ) }
    </Stack>;
}

////////////////////////////////////////////////////////////////////////////////////////////
// a background-image control (choose from library/browse/AI or clear) — for band / column backgrounds
function backgroundControl( block : EmailTemplate.Block, readOnly : boolean, props : EmailBlockInspector.Props ) : JSX.Element
{
    const url : string = String( block.props?.backgroundUrl ?? "" );
    return <Stack spacing={ 1 }>
        { url !== "" && <Box component="img" src={ url } alt="" sx={{ maxWidth: "100%", maxHeight: 120, borderRadius: 1, border: 1, borderColor: "divider" }} /> }
        <Stack direction="row" spacing={ 1 }>
            <Button size="small" variant="outlined" disabled={ readOnly } onClick={ () => props.onChooseImage( "backgroundUrl" ) }>{"Background image"}</Button>
            { url !== "" && <Button size="small" variant="text" disabled={ readOnly } onClick={ () => props.onPatchProps( { backgroundUrl: "" } ) }>{"Clear"}</Button> }
        </Stack>
    </Stack>;
}

////////////////////////////////////////////////////////////////////////////////////////////
// the social-network element list editor (children of a SOCIAL block) — add / edit / drag to reorder
function socialElements( block : EmailTemplate.Block, readOnly : boolean, props : EmailBlockInspector.Props ) : JSX.Element
{
    const elements : Array<EmailTemplate.Block> = block.children ?? [];
    return <Stack spacing={ 1 }>
        <Divider textAlign="left"><Typography variant="caption" sx={{ color: "text.secondary" }}>{"Networks"}</Typography></Divider>
        <DndContext collisionDetection={ closestCenter } onDragEnd={ ( event : DragEndEvent ) : void => { if( event.over ) props.onReorderSocialElements( block.id, String( event.active.id ), String( event.over.id ) ); } }>
            <SortableContext items={ elements.map( ( element : EmailTemplate.Block ) : string => `soc-${ element.id }` ) } strategy={ verticalListSortingStrategy }>
                <Stack spacing={ 1 }>
                    { elements.map( ( element : EmailTemplate.Block ) : JSX.Element => (
                        <SortableSocialRow key={ `soc-${ element.id }` } id={ `soc-${ element.id }` } element={ element } readOnly={ readOnly }
                                           onChangeNetwork={ ( oldName : string, oldHref : string, newName : string ) : void => props.onChangeSocialNetwork( element.id, oldName, oldHref, newName ) }
                                           onChangeHref={ ( value : string ) : void => props.onPatchSocialHref( element.id, value ) }
                                           onRemove={ () => props.onRemoveSocialElement( block.id, element.id ) } />
                    ) ) }
                </Stack>
            </SortableContext>
        </DndContext>
        <Button size="small" variant="text" startIcon={ <AddOutlinedIcon fontSize="small" /> } disabled={ readOnly } onClick={ () => props.onAddSocialElement( block.id ) }>{"Add network"}</Button>
    </Stack>;
}

////////////////////////////////////////////////////////////////////////////////////////////
// generic MJML-attributes editor for the block — any documented attribute is settable via the name dropdown
function attributesPanel( block : EmailTemplate.Block, readOnly : boolean, props : EmailBlockInspector.Props ) : JSX.Element
{
    const entries : Array<[ string, string ]> = Object.entries( block.attrs ?? {} );
    const used : Set<string> = new Set( entries.map( ( [ key ] : [ string, string ] ) : string => key ) );
    const available : Array<string> = standardAttrs( block.type ).filter( ( name : string ) : boolean => !used.has( name ) );
    // the name-dropdown choices for a row: its own key + the still-unused standard names
    const nameChoices : ( key : string ) => Array<SelectInput.Choice> = ( key : string ) : Array<SelectInput.Choice> => Array.from( new Set( [ key, ...available ] ) ).map( ( name : string ) : SelectInput.Choice => ( { value: name, label: name } ) );

    return <Stack spacing={ 1 }>
        <Divider textAlign="left"><Typography variant="caption" sx={{ color: "text.secondary" }}>{"MJML attributes"}</Typography></Divider>
        { entries.length === 0 && <Typography variant="caption" sx={{ color: "text.disabled" }}>{"No custom attributes."}</Typography> }
        { entries.map( ( [ key, value ] : [ string, string ] ) : JSX.Element => (
            <Stack key={ key } direction="row" spacing={ 1 } sx={{ alignItems: "center" }}>
                <Box sx={{ flex: 1 }}><SelectInput id={ `attr-k-${ key }` } label={"Attribute"} value={ key } choices={ nameChoices( key ) } dense disabled={ readOnly } onChange={ ( next : string ) : void => props.onRenameAttr( key, next ) } /></Box>
                <Box sx={{ flex: 1 }}><TextInput id={ `attr-v-${ key }` } label={""} placeHolder={"value"} value={ value } dense fullWidth disabled={ readOnly } onChange={ ( next : string ) : void => props.onSetAttr( key, next ) } /></Box>
                <ButtonIcon id={ `attr-del-${ key }` } label={"Remove"} size="small" disabled={ readOnly } icon={ <DeleteOutlineOutlinedIcon fontSize="small" /> } onClick={ () => props.onRemoveAttr( key ) } />
            </Stack>
        ) ) }
        <Button size="small" variant="text" startIcon={ <AddOutlinedIcon fontSize="small" /> } disabled={ readOnly || available.length === 0 } onClick={ () => props.onAddAttr( available[ 0 ] ?? "" ) }>{"Add attribute"}</Button>
    </Stack>;
}

export namespace EmailBlockInspector
{
    export interface Props
    {
        block                  : EmailTemplate.Block;   // the selected block
        readOnly?              : boolean;
        imgPending             : boolean;                // the referenced image variant isn't ready yet
        onPatchProps           : ( patch : Record<string, unknown> ) => void;
        onChooseImage          : ( target : "src" | "backgroundUrl" ) => void;
        onChangeVariant        : ( variant : string ) => void;
        // MJML attributes panel
        onRenameAttr           : ( oldKey : string, newKey : string ) => void;
        onSetAttr              : ( key : string, value : string ) => void;
        onRemoveAttr           : ( key : string ) => void;
        onAddAttr              : ( name : string ) => void;
        // social elements
        onAddSocialElement     : ( socialId : string ) => void;
        onRemoveSocialElement  : ( socialId : string, elementId : string ) => void;
        onChangeSocialNetwork  : ( elementId : string, oldName : string, oldHref : string, newName : string ) => void;
        onPatchSocialHref      : ( elementId : string, href : string ) => void;
        onReorderSocialElements : ( socialId : string, activeId : string, overId : string ) => void;
    }
}

export default EmailBlockInspector;
// eof
