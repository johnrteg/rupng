import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Button, Chip, Stack, Typography } from "@mui/material";
import AddOutlinedIcon           from '@mui/icons-material/AddOutlined';
import VisibilityOutlinedIcon    from '@mui/icons-material/VisibilityOutlined';
import SettingsOutlinedIcon      from '@mui/icons-material/SettingsOutlined';
import HistoryOutlinedIcon       from '@mui/icons-material/HistoryOutlined';
import SendOutlinedIcon          from '@mui/icons-material/SendOutlined';
import AlternateEmailOutlinedIcon from '@mui/icons-material/AlternateEmailOutlined';

import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';

import { EmailTemplate, Email, GetEmailTemplate, GetMediaUrl, PatchEmailTemplate, PostEmailTemplatePublish, PostEmailPreview, PostEmailSend, GetEmailTemplateVersion, PostEmailTemplateRevert } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import ButtonIcon from '@widgets/core/ButtonIcon';
import TextInput  from '@widgets/core/TextInput';
import SelectInput from '@widgets/core/SelectInput';
import AlertPrompt from '@widgets/core/AlertPrompt';
import SnackAlert  from '@widgets/core/SnackAlert';
import EmailImagePickerDialog from '@widgets/email/EmailImagePickerDialog';
import EmailPreviewPanel from '@widgets/email/EmailPreviewPanel';
import VersionHistoryDialog from '@widgets/email/VersionHistoryDialog';
import TestSendDialog from '@widgets/email/TestSendDialog';
import EmailSenderDialog from '@widgets/email/EmailSenderDialog';
import SortableSection from '@widgets/email/editor/SortableSection';
import EmailBlockInspector from '@widgets/email/editor/EmailBlockInspector';
import EmailDocumentSettings from '@widgets/email/editor/EmailDocumentSettings';
import { SAMPLE_MERGE, socialBaseUrl, DEFAULT_IMAGE_VARIANT } from '@widgets/email/editor/EmailEditorModel';

// the notification-event choices for a managed template ("" = not tied to an event)
const EVENT_CHOICES : Array<SelectInput.Choice> =
    [ { value: "", label: "(no event)" }, ...Object.values( Email.NotificationType ).map( ( value : Email.NotificationType ) : SelectInput.Choice => ( { value, label: value } ) ) ];

//
// EmailTemplateEditor — the SELF-CONTAINED, host-agnostic email block editor (email-2.6). MANAGED (a stored
// `templateId`) or DOCUMENT (`doc` + `onDocChange`) mode. Bands (section / hero) → columns → content blocks.
// Composes the editor family under `editor/`: draggable sections (SortableSection), the property inspector
// (EmailBlockInspector), and the document-settings panel (EmailDocumentSettings). Owns the doc + selection
// state + all tree mutations + the managed server actions (save / publish / preview / test / versions).
//
export function EmailTemplateEditor( props : EmailTemplateEditor.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [doc,setDoc]         = React.useState< EmailTemplate.Doc >( props.doc ?? EmailTemplate.DEFAULT_DOC );
    const [subject,setSubject] = React.useState< string >( props.subject ?? "" );
    const [saved,setSaved]     = React.useState< string >( "" );   // JSON of the last-saved { doc, subject } (managed)
    const [selected,setSelected] = React.useState< string | null >( null );   // selected block id (any level)
    const [docOpen,setDocOpen]   = React.useState< boolean >( false );         // document-settings inspector open
    const [status,setStatus]   = React.useState< string >( "" );
    const [snack,setSnack]     = React.useState< { message : string; severity : SnackAlert.Severity } | null >( null );   // transient toast (e.g. test-send result)
    const [preview,setPreview] = React.useState< Email.PreviewViewport | null >( null );   // preview drawer viewport
    const [previewHtml,setPreviewHtml] = React.useState< string >( "" );
    const [imageTarget,setImageTarget] = React.useState< "src" | "backgroundUrl" | null >( null );   // open image picker for this prop
    const [imgPending,setImgPending]   = React.useState< boolean >( false );   // referenced image variant not yet ready (media still processing)
    const [confirmDelete,setConfirmDelete] = React.useState< string | null >( null );   // section id pending delete-confirm
    const [entity,setEntity]       = React.useState< EmailTemplate.Entity | null >( null );   // the loaded template (managed) — carries version + history
    const [historyOpen,setHistoryOpen]     = React.useState< boolean >( false );   // version-history dialog
    const [testOpen,setTestOpen]           = React.useState< boolean >( false );   // test-send dialog
    const [senderOpen,setSenderOpen]       = React.useState< boolean >( false );   // from / reply-to dialog
    const [confirmRestore,setConfirmRestore] = React.useState< number | null >( null );   // version pending restore-confirm

    // a PUBLISHED template is LIVE — never editable (duplicate it to a draft to change it). Also honors the prop.
    const published : boolean = entity?.status === EmailTemplate.Status.PUBLISHED;
    const readOnly : boolean = props.readOnly === true || published;
    const managed : boolean = props.templateId !== undefined;

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( templateChanged, [ props.templateId ] );
    React.useEffect( docChanged, [ doc, subject ] );

    // load the bound template when the templateId prop changes (managed mode)
    function templateChanged() : void { if( props.templateId ) void load( props.templateId ); }

    // re-compile the preview whenever the doc/subject changes WHILE the preview panel is open, so edits show live
    function docChanged() : void { if( preview !== null ) void refreshPreview(); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function load( id : string ) : Promise<void>
    {
        const reply : RestfulService.Reply<GetEmailTemplate.Response> = await appmodel.server.fetch( new GetEmailTemplate( id ) );
        if( reply.ok && reply.data ) { setEntity( reply.data.template ); setDoc( reply.data.template.doc ); setSubject( reply.data.template.subject ); setSaved( JSON.stringify( { doc: reply.data.template.doc, subject: reply.data.template.subject } ) ); }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // commit a doc change: update state + (document mode) notify the host
    function commit( nextDoc : EmailTemplate.Doc ) : void { setDoc( nextDoc ); if( props.onDocChange ) props.onDocChange( nextDoc, subject ); }
    function uid() : string { return globalThis.crypto.randomUUID(); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // deep-clone a block subtree with fresh ids (for dropping a stock section)
    function freshIds( block : EmailTemplate.Block ) : EmailTemplate.Block
    {
        return { id: uid(), type: block.type, props: block.props ? { ...block.props } : undefined, attrs: block.attrs ? { ...block.attrs } : undefined, children: block.children ? block.children.map( freshIds ) : undefined };
    }
    // select a block for the inspector (closes the document-settings view; clears any stale pending flag)
    function selectBlock( id : string ) : void { setSelected( id ); setDocOpen( false ); setImgPending( false ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── doc-tree helpers ─────────────────────────────────────────────────────────────────────
    // map the section (top-level band) through `fn`
    function mapSection( sectionId : string, fn : ( section : EmailTemplate.Block ) => EmailTemplate.Block ) : EmailTemplate.Doc
    {
        return { ...doc, blocks: doc.blocks.map( ( section : EmailTemplate.Block ) : EmailTemplate.Block => ( section.id === sectionId ? fn( section ) : section ) ) };
    }
    // map the column (sectionId, columnId) through `fn`
    function mapColumn( sectionId : string, columnId : string, fn : ( column : EmailTemplate.Block ) => EmailTemplate.Block ) : EmailTemplate.Doc
    {
        return mapSection( sectionId, ( section : EmailTemplate.Block ) : EmailTemplate.Block => ( { ...section, children: ( section.children ?? [] ).map( ( column : EmailTemplate.Block ) : EmailTemplate.Block => ( column.id === columnId ? fn( column ) : column ) ) } ) );
    }
    // locate a content block within a column → its section + column + the block (for content add/remove/reorder)
    function findBlock( blockId : string ) : { sectionId : string; columnId : string; block : EmailTemplate.Block } | undefined
    {
        for( const section of doc.blocks )
            for( const column of section.children ?? [] )
            {
                const block : EmailTemplate.Block | undefined = ( column.children ?? [] ).find( ( item : EmailTemplate.Block ) : boolean => item.id === blockId );
                if( block ) return { sectionId: section.id, columnId: column.id, block };
            }
        return undefined;
    }
    // find ANY block (any depth) by id — used by the inspector (sections, columns, content, social elements)
    function locate( blockId : string, blocks : Array<EmailTemplate.Block> = doc.blocks ) : EmailTemplate.Block | undefined
    {
        for( const block of blocks )
        {
            if( block.id === blockId ) return block;
            const nested : EmailTemplate.Block | undefined = block.children ? locate( blockId, block.children ) : undefined;
            if( nested ) return nested;
        }
        return undefined;
    }
    function selectedBlock() : EmailTemplate.Block | undefined { return selected ? locate( selected ) : undefined; }

    // recursively map ANY block by id through `fn`
    function walk( blocks : Array<EmailTemplate.Block>, blockId : string, fn : ( block : EmailTemplate.Block ) => EmailTemplate.Block ) : Array<EmailTemplate.Block>
    {
        return blocks.map( ( block : EmailTemplate.Block ) : EmailTemplate.Block => ( block.id === blockId ? fn( block ) : ( block.children ? { ...block, children: walk( block.children, blockId, fn ) } : block ) ) );
    }
    // patch ANY block by id (recursive) through `fn` and commit — the generic write path
    function patchBlockById( blockId : string, fn : ( block : EmailTemplate.Block ) => EmailTemplate.Block ) : void
    {
        commit( { ...doc, blocks: walk( doc.blocks, blockId, fn ) } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── mutations ──────────────────────────────────────────────────────────────────────────────
    // add a stock section (a prebuilt template) or a blank section
    function addBand( kind : "blank" | EmailTemplate.StockSection ) : void
    {
        const base : EmailTemplate.Block = kind === "blank"
            ? { id: uid(), type: EmailTemplate.BlockType.SECTION, children: [ { id: uid(), type: EmailTemplate.BlockType.COLUMN, children: [] } ] }
            : freshIds( kind.block );
        const label : string = kind === "blank" ? "Section" : kind.label;
        const section : EmailTemplate.Block = { ...base, props: { ...base.props, name: label } };   // seed the inline name
        commit( { ...doc, blocks: [ ...doc.blocks, section ] } );
    }
    function removeSection( sectionId : string ) : void
    {
        commit( { ...doc, blocks: doc.blocks.filter( ( section : EmailTemplate.Block ) : boolean => section.id !== sectionId ) } );
        if( selected === sectionId ) setSelected( null );
    }
    function renameSection( sectionId : string, name : string ) : void
    { commit( mapSection( sectionId, ( section : EmailTemplate.Block ) : EmailTemplate.Block => ( { ...section, props: { ...section.props, name } } ) ) ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // set a section's column count — grow by appending empty columns; shrink by MERGING the dropped columns'
    // blocks into the last kept column (never lose content)
    function setColumns( sectionId : string, count : number ) : void
    {
        commit( mapSection( sectionId, ( section : EmailTemplate.Block ) : EmailTemplate.Block =>
        {
            const cols : Array<EmailTemplate.Block> = section.children ?? [];
            if( count === cols.length ) return section;
            if( count > cols.length )
            {
                const added : Array<EmailTemplate.Block> = Array.from( { length: count - cols.length }, () : EmailTemplate.Block => ( { id: uid(), type: EmailTemplate.BlockType.COLUMN, children: [] } ) );
                return { ...section, children: [ ...cols, ...added ] };
            }
            const kept : Array<EmailTemplate.Block> = cols.slice( 0, count );
            const droppedBlocks : Array<EmailTemplate.Block> = cols.slice( count ).flatMap( ( column : EmailTemplate.Block ) : Array<EmailTemplate.Block> => column.children ?? [] );
            const merged : Array<EmailTemplate.Block> = kept.map( ( column : EmailTemplate.Block, index : number ) : EmailTemplate.Block => ( index === kept.length - 1 ? { ...column, children: [ ...( column.children ?? [] ), ...droppedBlocks ] } : column ) );
            return { ...section, children: merged };
        } ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // add a content block to a column (social blocks seed two starter elements so they render)
    function addBlock( sectionId : string, columnId : string, type : EmailTemplate.BlockType ) : void
    {
        const children : Array<EmailTemplate.Block> | undefined = type === EmailTemplate.BlockType.SOCIAL
            ? [ { id: uid(), type: EmailTemplate.BlockType.SOCIAL_ELEMENT, props: { name: "facebook", href: socialBaseUrl( "facebook" ) } }, { id: uid(), type: EmailTemplate.BlockType.SOCIAL_ELEMENT, props: { name: "twitter", href: socialBaseUrl( "twitter" ) } } ]
            : undefined;
        const block : EmailTemplate.Block = { id: uid(), type, props: EmailTemplateEditor.defaultProps( type ), children };
        commit( mapColumn( sectionId, columnId, ( column : EmailTemplate.Block ) : EmailTemplate.Block => ( { ...column, children: [ ...( column.children ?? [] ), block ] } ) ) );
        selectBlock( block.id );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function removeBlock( blockId : string ) : void
    {
        const loc : { sectionId : string; columnId : string; block : EmailTemplate.Block } | undefined = findBlock( blockId );
        if( !loc ) return;
        commit( mapColumn( loc.sectionId, loc.columnId, ( column : EmailTemplate.Block ) : EmailTemplate.Block => ( { ...column, children: ( column.children ?? [] ).filter( ( item : EmailTemplate.Block ) : boolean => item.id !== blockId ) } ) ) );
        if( selected === blockId ) setSelected( null );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // reorder top-level sections (drag) — ids are `section-<id>`
    function reorderSections( activeId : string, overId : string ) : void
    {
        const ids : Array<string> = doc.blocks.map( ( section : EmailTemplate.Block ) : string => `section-${ section.id }` );
        const from : number = ids.indexOf( activeId );
        const to : number = ids.indexOf( overId );
        if( from < 0 || to < 0 || from === to ) return;
        commit( { ...doc, blocks: arrayMove( doc.blocks, from, to ) } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // reorder columns within a section (drag) — ids are `col-<id>`
    function reorderColumns( sectionId : string, activeId : string, overId : string ) : void
    {
        const section : EmailTemplate.Block | undefined = doc.blocks.find( ( item : EmailTemplate.Block ) : boolean => item.id === sectionId );
        if( !section ) return;
        const cols : Array<EmailTemplate.Block> = section.children ?? [];
        const ids : Array<string> = cols.map( ( column : EmailTemplate.Block ) : string => `col-${ column.id }` );
        const from : number = ids.indexOf( activeId );
        const to : number = ids.indexOf( overId );
        if( from < 0 || to < 0 || from === to ) return;
        commit( mapSection( sectionId, ( sec : EmailTemplate.Block ) : EmailTemplate.Block => ( { ...sec, children: arrayMove( cols, from, to ) } ) ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // reorder content blocks WITHIN a column (drag) — ids are `block-<id>`
    function reorderBlocks( sectionId : string, columnId : string, activeId : string, overId : string ) : void
    {
        const section : EmailTemplate.Block | undefined = doc.blocks.find( ( item : EmailTemplate.Block ) : boolean => item.id === sectionId );
        const column : EmailTemplate.Block | undefined = section ? ( section.children ?? [] ).find( ( item : EmailTemplate.Block ) : boolean => item.id === columnId ) : undefined;
        if( !column ) return;
        const content : Array<EmailTemplate.Block> = column.children ?? [];
        const ids : Array<string> = content.map( ( block : EmailTemplate.Block ) : string => `block-${ block.id }` );
        const from : number = ids.indexOf( activeId );
        const to : number = ids.indexOf( overId );
        if( from < 0 || to < 0 || from === to ) return;
        commit( mapColumn( sectionId, columnId, ( col : EmailTemplate.Block ) : EmailTemplate.Block => ( { ...col, children: arrayMove( content, from, to ) } ) ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── selected-block edits (props / attrs) ───────────────────────────────────────────────────
    function patchProps( patch : Record<string, unknown> ) : void { if( selected ) patchBlockById( selected, ( block : EmailTemplate.Block ) : EmailTemplate.Block => ( { ...block, props: { ...block.props, ...patch } } ) ); }
    function setAttrs( attrs : Record<string, string> ) : void   { if( selected ) patchBlockById( selected, ( block : EmailTemplate.Block ) : EmailTemplate.Block => ( { ...block, attrs } ) ); }
    // generic MJML-attribute edits on the selected block
    function renameAttr( oldKey : string, newKey : string ) : void
    {
        const block : EmailTemplate.Block | undefined = selectedBlock();
        if( !block ) return;
        const next : Record<string, string> = { ...block.attrs };
        const value : string = next[ oldKey ] ?? "";
        delete next[ oldKey ];
        if( newKey !== "" ) next[ newKey ] = value;
        setAttrs( next );
    }
    function setAttr( key : string, value : string ) : void
    { const block : EmailTemplate.Block | undefined = selectedBlock(); if( block ) setAttrs( { ...block.attrs, [ key ]: value } ); }
    function removeAttr( key : string ) : void
    { const block : EmailTemplate.Block | undefined = selectedBlock(); if( !block ) return; const next : Record<string, string> = { ...block.attrs }; delete next[ key ]; setAttrs( next ); }
    function addAttr( name : string ) : void
    { if( name !== "" ) setAttr( name, "" ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── social-element editing (children of a SOCIAL block) ─────────────────────────────────────
    function addSocialElement( socialId : string ) : void { patchBlockById( socialId, ( block : EmailTemplate.Block ) : EmailTemplate.Block => ( { ...block, children: [ ...( block.children ?? [] ), { id: uid(), type: EmailTemplate.BlockType.SOCIAL_ELEMENT, props: { name: "web", href: socialBaseUrl( "web" ) } } ] } ) ); }
    function removeSocialElement( socialId : string, elementId : string ) : void { patchBlockById( socialId, ( block : EmailTemplate.Block ) : EmailTemplate.Block => ( { ...block, children: ( block.children ?? [] ).filter( ( child : EmailTemplate.Block ) : boolean => child.id !== elementId ) } ) ); }
    function patchSocialElement( elementId : string, patch : Record<string, unknown> ) : void { patchBlockById( elementId, ( block : EmailTemplate.Block ) : EmailTemplate.Block => ( { ...block, props: { ...block.props, ...patch } } ) ); }
    // change a social element's network — prefill its link with the network's typical base URL when the link is
    // empty or still the previous network's untouched base (never clobber a customized link)
    function changeSocialNetwork( elementId : string, oldName : string, oldHref : string, newName : string ) : void
    {
        const href : string = ( oldHref === "" || oldHref === socialBaseUrl( oldName ) ) ? socialBaseUrl( newName ) : oldHref;
        patchSocialElement( elementId, { name: newName, href } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // reorder a SOCIAL block's network elements (drag) — ids are `soc-<elementId>`
    function reorderSocialElements( socialId : string, activeId : string, overId : string ) : void
    {
        patchBlockById( socialId, ( block : EmailTemplate.Block ) : EmailTemplate.Block =>
        {
            const elements : Array<EmailTemplate.Block> = block.children ?? [];
            const ids : Array<string> = elements.map( ( element : EmailTemplate.Block ) : string => `soc-${ element.id }` );
            const from : number = ids.indexOf( activeId );
            const to : number = ids.indexOf( overId );
            if( from < 0 || to < 0 || from === to ) return block;
            return { ...block, children: arrayMove( elements, from, to ) };
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── document-level (settings + head) editing ────────────────────────────────────────────────
    function patchSettings( patch : Partial<EmailTemplate.DocSettings> ) : void { commit( { ...doc, settings: { ...doc.settings, ...patch } } ); }
    function patchHead( patch : Partial<EmailTemplate.Head> ) : void { commit( { ...doc, head: { ...doc.head, ...patch } } ); }

    // SINGLE drag-end handler for the whole document (one DndContext, nested SortableContexts). dnd-kit does NOT
    // support nested DndContexts, so all three levels dispatch here by the dragged id's prefix.
    function onDragEnd( event : DragEndEvent ) : void
    {
        const active : string = String( event.active.id );
        const over : string = event.over ? String( event.over.id ) : "";
        if( over === "" || active === over ) return;
        // top-level sections
        if( active.startsWith( "section-" ) ) { reorderSections( active, over ); return; }
        // columns — reorder within their owning section (over must be a sibling column)
        if( active.startsWith( "col-" ) )
        {
            const section : EmailTemplate.Block | undefined = doc.blocks.find( ( item : EmailTemplate.Block ) : boolean => ( item.children ?? [] ).some( ( column : EmailTemplate.Block ) : boolean => `col-${ column.id }` === active ) );
            if( section && ( section.children ?? [] ).some( ( column : EmailTemplate.Block ) : boolean => `col-${ column.id }` === over ) ) reorderColumns( section.id, active, over );
            return;
        }
        // content blocks — reorder within their owning column (over must be a sibling block)
        if( active.startsWith( "block-" ) )
        {
            const loc : { sectionId : string; columnId : string; block : EmailTemplate.Block } | undefined = findBlock( active.slice( "block-".length ) );
            if( !loc ) return;
            const section : EmailTemplate.Block | undefined = doc.blocks.find( ( item : EmailTemplate.Block ) : boolean => item.id === loc.sectionId );
            const column : EmailTemplate.Block | undefined = section ? ( section.children ?? [] ).find( ( item : EmailTemplate.Block ) : boolean => item.id === loc.columnId ) : undefined;
            if( column && ( column.children ?? [] ).some( ( item : EmailTemplate.Block ) : boolean => `block-${ item.id }` === over ) ) reorderBlocks( loc.sectionId, loc.columnId, active, over );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── image reference resolution ──────────────────────────────────────────────────────────────
    // resolve a library image's variant → a delivery URL. Returns "" when the variant isn't ready yet (media is
    // still deriving renditions) so the caller can show a PENDING placeholder.
    async function resolveVariantUrl( guid : string, variant : string ) : Promise<string>
    {
        const reply : RestfulService.Reply<GetMediaUrl.Response> = await appmodel.server.fetch( new GetMediaUrl( guid, variant ) );
        return reply.ok && reply.data ? reply.data.url : "";
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // image-picker result → for a content image, store the LIBRARY REFERENCE (guid + name + variant) and resolve
    // the default (mobile) variant's URL; for a background, store the resolved URL directly
    async function onImagePicked( pick : EmailImagePickerDialog.Pick ) : Promise<void>
    {
        const target : "src" | "backgroundUrl" | null = imageTarget;
        setImageTarget( null );
        if( target === "backgroundUrl" ) { patchProps( { backgroundUrl: pick.url } ); return; }
        setImgPending( true );
        const url : string = await resolveVariantUrl( pick.guid, DEFAULT_IMAGE_VARIANT );
        patchProps( { assetGuid: pick.guid, assetName: pick.name, variant: DEFAULT_IMAGE_VARIANT, src: url || pick.url, alt: pick.name } );
        setImgPending( url === "" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // re-point the selected image to a different variant (rendition) and re-resolve its URL
    async function onChangeVariant( variant : string ) : Promise<void>
    {
        const block : EmailTemplate.Block | undefined = selectedBlock();
        const guid : string = String( block?.props?.assetGuid ?? "" );
        if( guid === "" ) { patchProps( { variant } ); return; }
        setImgPending( true );
        const url : string = await resolveVariantUrl( guid, variant );
        patchProps( { variant, src: url || String( block?.props?.src ?? "" ) } );
        setImgPending( url === "" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── server actions (managed mode) ──────────────────────────────────────────────────────────
    async function onSave() : Promise<void>
    {
        if( !props.templateId ) return;
        setStatus( "Saving…" );
        const reply : RestfulService.Reply<PatchEmailTemplate.Response> = await appmodel.server.fetch( new PatchEmailTemplate( props.templateId, { doc, subject } ) );
        setStatus( reply.ok ? "Saved" : "Save failed" );
        if( reply.ok ) { setSaved( JSON.stringify( { doc, subject } ) ); void load( props.templateId ); if( props.onSaved ) props.onSaved(); }
    }
    async function onPublish() : Promise<void>
    {
        if( !props.templateId ) return;
        setStatus( "Publishing…" );
        const reply : RestfulService.Reply<PostEmailTemplatePublish.Response> = await appmodel.server.fetch( new PostEmailTemplatePublish( props.templateId ) );
        setStatus( reply.ok ? "Published" : "Publish failed" );
        if( reply.ok ) void load( props.templateId );
    }
    // assign / change the notification EVENT this template serves (immediate patch — metadata, not doc)
    async function onChangeEvent( notif : string ) : Promise<void>
    {
        if( !props.templateId ) return;
        const reply : RestfulService.Reply<PatchEmailTemplate.Response> = await appmodel.server.fetch( new PatchEmailTemplate( props.templateId, { notificationType: notif as Email.NotificationType } ) );
        setStatus( reply.ok ? "Event updated" : "Update failed" );
        if( reply.ok ) void load( props.templateId );
    }
    // save the from / reply-to overrides ("" clears a previously-saved address) and reload the entity
    async function onSaveSender( from : Email.Address | "", replyTo : Email.Address | "" ) : Promise<boolean>
    {
        if( !props.templateId ) return false;
        const reply : RestfulService.Reply<PatchEmailTemplate.Response> = await appmodel.server.fetch( new PatchEmailTemplate( props.templateId, { from, replyTo } ) );
        setStatus( reply.ok ? "Sender updated" : "Update failed" );
        if( reply.ok ) await load( props.templateId );
        return reply.ok;
    }
    // re-compile the current doc + subject and refresh the previewed HTML (leaves the open viewport/mode alone)
    async function refreshPreview() : Promise<void>
    {
        const reply : RestfulService.Reply<PostEmailPreview.Response> = await appmodel.server.fetch( new PostEmailPreview( { doc, subject, mergeData: SAMPLE_MERGE } ) );
        if( reply.ok && reply.data ) setPreviewHtml( reply.data.html );
    }
    // open the preview panel for a viewport — compile the current doc first
    async function openPreview( mode : Email.PreviewViewport ) : Promise<void>
    {
        await refreshPreview();
        setPreview( mode );
    }
    // confirm-delete a section (AlertPrompt result) — remove only on YES; always clear the prompt
    async function onDeleteSectionAction( action : AlertPrompt.Action ) : Promise<void>
    {
        if( action === AlertPrompt.Action.YES && confirmDelete ) removeSection( confirmDelete );
        setConfirmDelete( null );
    }
    // TEST send — compile the CURRENT design (sample merge data) and email it to `address` (reflects unsaved edits)
    async function sendTest( address : string ) : Promise<boolean>
    {
        const preview : RestfulService.Reply<PostEmailPreview.Response> = await appmodel.server.fetch( new PostEmailPreview( { doc, subject, mergeData: SAMPLE_MERGE } ) );
        const html : string = preview.ok && preview.data ? preview.data.html : "";
        const subj : string = preview.ok && preview.data ? preview.data.subject : subject;
        const recipient : Email.Recipient = { email: address };
        const sent : RestfulService.Reply<PostEmailSend.Response> = await appmodel.server.fetch( new PostEmailSend( { to: [ recipient ], subject: subj, html } ) );
        setSnack( sent.ok ? { message: `Test sent to ${ address }`, severity: "success" } : { message: "Test send failed", severity: "error" } );
        return sent.ok;
    }
    // preview an earlier version's compiled HTML in the drawer (no change to the working doc)
    async function previewVersion( version : number ) : Promise<void>
    {
        if( !props.templateId ) return;
        const reply : RestfulService.Reply<GetEmailTemplateVersion.Response> = await appmodel.server.fetch( new GetEmailTemplateVersion( props.templateId, version ) );
        if( reply.ok && reply.data )
        {
            setPreviewHtml( reply.data.body.html ?? "" );
            setPreview( Email.PreviewViewport.DESKTOP );
        }
    }
    // restore the confirmed version (AlertPrompt result) — on YES the server writes a new current version + reload
    async function onRestoreAction( action : AlertPrompt.Action ) : Promise<void>
    {
        if( action === AlertPrompt.Action.YES && props.templateId && confirmRestore !== null )
        {
            const reply : RestfulService.Reply<PostEmailTemplateRevert.Response> = await appmodel.server.fetch( new PostEmailTemplateRevert( props.templateId, { version: confirmRestore } ) );
            if( reply.ok ) { setStatus( `Restored v${ confirmRestore }` ); await load( props.templateId ); if( props.onSaved ) props.onSaved(); }
            else setStatus( "Restore failed" );
        }
        setConfirmRestore( null );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // you can Save when dirty; you can only Publish once saved (clean) so you publish what's stored
    const dirty : boolean = managed && JSON.stringify( { doc, subject } ) !== saved;
    const selectedBlk : EmailTemplate.Block | undefined = selectedBlock();

    return <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>

        {/* toolbar */}
        <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", px: 2, py: 1, borderBottom: "1px solid", borderColor: "divider", flexWrap: "wrap" }}>
            <Box sx={{ minWidth: 220, flexGrow: 1, maxWidth: 420 }}>
                <TextInput id="tpl-subject" label={"Subject"} value={ subject } fullWidth disabled={ readOnly }
                           onChange={ ( value : string ) : void => { setSubject( value ); if( props.onDocChange ) props.onDocChange( doc, value ); } } />
            </Box>
            { managed && entity &&
                <Box sx={{ minWidth: 180 }}>
                    <SelectInput id="tpl-event" label={"Event"} value={ entity.notificationType ?? "" } choices={ EVENT_CHOICES } disabled={ readOnly } dense onChange={ ( value : string ) : void => void onChangeEvent( value ) } />
                </Box> }
            { status && <Chip size="small" variant="outlined" label={ status } /> }
            { managed && entity && <Chip size="small" variant="outlined" label={ `v${ entity.version }` } /> }
            { published && <Chip size="small" color="success" label={"Published — read-only"} /> }
            <Box sx={{ flexGrow: 1 }} />
            { !readOnly && <ButtonIcon id="tpl-test" label={"Send a test"} size="small" icon={ <SendOutlinedIcon fontSize="small" /> } onClick={ () => setTestOpen( true ) } /> }
            { managed && !readOnly && <ButtonIcon id="tpl-sender" label={"From & reply-to"} size="small" icon={ <AlternateEmailOutlinedIcon fontSize="small" /> } onClick={ () => setSenderOpen( true ) } /> }
            { managed && entity && ( entity.versions ?? [] ).length > 0 &&
                <ButtonIcon id="tpl-history" label={"History"} size="small" icon={ <HistoryOutlinedIcon fontSize="small" /> } onClick={ () => setHistoryOpen( true ) } /> }
            <ButtonIcon id="tpl-document" label={"Document settings"} size="small" icon={ <SettingsOutlinedIcon fontSize="small" /> } onClick={ () => { setDocOpen( true ); setSelected( null ); } } />
            <ButtonIcon id="tpl-preview-open" label={"Preview"} size="small" icon={ <VisibilityOutlinedIcon fontSize="small" /> } onClick={ () => void openPreview( Email.PreviewViewport.DESKTOP ) } />
            {/* a published template is live + read-only → the only edit path is to duplicate it into a draft */}
            { published && props.onDuplicate && <Button size="small" variant="contained" onClick={ props.onDuplicate }>{"Duplicate to edit"}</Button> }
            { managed && !readOnly && <Button size="small" variant="contained" disabled={ !dirty } onClick={ () => void onSave() }>{"Save"}</Button> }
            { managed && !readOnly && <Button size="small" variant="outlined" disabled={ dirty } onClick={ () => void onPublish() }>{"Publish"}</Button> }
            { props.onClose && <Button size="small" onClick={ props.onClose }>{"Close"}</Button> }
        </Stack>

        <Box sx={{ display: "flex", flexGrow: 1, minHeight: 0 }}>

            {/* add-section palette */}
            <Box sx={{ width: 180, flexShrink: 0, borderRight: "1px solid", borderColor: "divider", overflow: "auto", p: 1 }}>
                <Typography variant="overline" sx={{ color: "text.secondary" }}>{"Add section"}</Typography>
                <Stack spacing={ 1 } sx={{ mt: 1 }}>
                    { EmailTemplate.STOCK_SECTIONS.map( ( stock : EmailTemplate.StockSection ) : JSX.Element => (
                        <Button key={ stock.key } size="small" variant="outlined" disabled={ readOnly } startIcon={ <AddOutlinedIcon fontSize="small" /> } onClick={ () => addBand( stock ) }>{ stock.label }</Button>
                    ) ) }
                    <Button size="small" disabled={ readOnly } startIcon={ <AddOutlinedIcon fontSize="small" /> } onClick={ () => addBand( "blank" ) }>{"Blank"}</Button>
                </Stack>
            </Box>

            {/* document — draggable sections + columns + blocks */}
            <Box sx={{ flexGrow: 1, minWidth: 0, overflow: "auto", p: 2, bgcolor: "background.default" }}>
                { doc.blocks.length === 0 && <Typography variant="body2" sx={{ color: "text.secondary" }}>{"Empty — add a section from the left."}</Typography> }
                <DndContext collisionDetection={ closestCenter } onDragEnd={ onDragEnd }>
                    <SortableContext items={ doc.blocks.map( ( section : EmailTemplate.Block ) : string => `section-${ section.id }` ) } strategy={ verticalListSortingStrategy }>
                        <Stack spacing={ 1 }>
                            { doc.blocks.map( ( section : EmailTemplate.Block ) : JSX.Element => (
                                <SortableSection key={ `section-${ section.id }` } id={ `section-${ section.id }` } section={ section } selected={ selected === section.id } selectedBlockId={ selected } readOnly={ readOnly }
                                                 onRename={ ( name : string ) : void => renameSection( section.id, name ) }
                                                 onSelectSection={ () => selectBlock( section.id ) }
                                                 onDeleteSection={ () => setConfirmDelete( section.id ) }
                                                 onSetColumns={ ( count : number ) : void => setColumns( section.id, count ) }
                                                 onAddBlock={ ( columnId : string, type : EmailTemplate.BlockType ) : void => addBlock( section.id, columnId, type ) }
                                                 onSelectBlock={ ( id : string ) : void => selectBlock( id ) }
                                                 onDeleteBlock={ ( id : string ) : void => removeBlock( id ) } />
                            ) ) }
                        </Stack>
                    </SortableContext>
                </DndContext>
            </Box>

            {/* right pane — inspector / document settings */}
            <Box sx={{ width: 540, flexShrink: 0, borderLeft: "1px solid", borderColor: "divider", overflow: "auto" }}>
                { docOpen
                    ? <EmailDocumentSettings doc={ doc } readOnly={ readOnly } onPatchSettings={ patchSettings } onPatchHead={ patchHead } />
                    : selectedBlk
                        ? <EmailBlockInspector block={ selectedBlk } readOnly={ readOnly } imgPending={ imgPending }
                                               onPatchProps={ patchProps }
                                               onChooseImage={ ( target : "src" | "backgroundUrl" ) : void => setImageTarget( target ) }
                                               onChangeVariant={ ( variant : string ) : void => void onChangeVariant( variant ) }
                                               onRenameAttr={ renameAttr } onSetAttr={ setAttr } onRemoveAttr={ removeAttr } onAddAttr={ addAttr }
                                               onAddSocialElement={ addSocialElement } onRemoveSocialElement={ removeSocialElement }
                                               onChangeSocialNetwork={ changeSocialNetwork }
                                               onPatchSocialHref={ ( elementId : string, href : string ) : void => patchSocialElement( elementId, { href } ) }
                                               onReorderSocialElements={ reorderSocialElements } />
                        : <Typography variant="body2" sx={{ color: "text.secondary", p: 2 }}>{"Select a block, column, or section to edit it."}</Typography> }
            </Box>

            {/* preview panel — docked inline (not an overlay) so it stays visible alongside the editor; Close hides it, the toolbar's eye icon reopens it */}
            { preview !== null &&
                <EmailPreviewPanel mode={ preview } html={ previewHtml } onMode={ ( mode : Email.PreviewViewport ) : void => setPreview( mode ) } onClose={ () => setPreview( null ) } /> }
        </Box>

        {/* image picker — library / browse / AI (imports to the campaign library) */}
        { imageTarget !== null &&
            <EmailImagePickerDialog campaignId={ props.campaignId }
                                    onPick={ ( pick : EmailImagePickerDialog.Pick ) : void => void onImagePicked( pick ) }
                                    onClose={ () => setImageTarget( null ) } /> }

        {/* confirm delete section */}
        { confirmDelete !== null &&
            <AlertPrompt id="tpl-del-section" type={ AlertPrompt.Type.WARNING } title={"Delete section"}
                         message={"Delete this section and all of its content? This can't be undone."}
                         yesText={"Delete"} yesColor={"error"} cancelText={"Cancel"} onAction={ onDeleteSectionAction } /> }

        {/* test send — email the current design to an address */}
        { testOpen &&
            <TestSendDialog onSend={ sendTest } onClose={ () => setTestOpen( false ) } /> }

        {/* from / reply-to overrides saved with the template */}
        { senderOpen &&
            <EmailSenderDialog from={ entity?.from } replyTo={ entity?.replyTo }
                               onSave={ ( from : Email.Address | "", replyTo : Email.Address | "" ) : Promise<boolean> => onSaveSender( from, replyTo ) }
                               onClose={ () => setSenderOpen( false ) } /> }

        {/* transient toast — e.g. test-send result */}
        { snack &&
            <SnackAlert message={ snack.message } severity={ snack.severity } onClose={ () => setSnack( null ) } /> }

        {/* version history — preview / restore an earlier saved version */}
        { historyOpen && entity &&
            <VersionHistoryDialog versions={ entity.versions ?? [] } currentVersion={ entity.version }
                                  onPreview={ ( version : number ) : void => void previewVersion( version ) }
                                  onRestore={ ( version : number ) : void => { setHistoryOpen( false ); setConfirmRestore( version ); } }
                                  onClose={ () => setHistoryOpen( false ) } /> }

        {/* confirm restore version (state change → confirm) */}
        { confirmRestore !== null &&
            <AlertPrompt id="tpl-restore-version" type={ AlertPrompt.Type.QUESTION } title={"Restore version"}
                         message={ `Restore version ${ confirmRestore } as a new draft? The current content is kept in history.` }
                         yesText={"Restore"} cancelText={"Cancel"} onAction={ onRestoreAction } /> }
    </Box>;
}

export namespace EmailTemplateEditor
{
    export interface Props
    {
        // MANAGED mode — bound to a stored template (loads/saves/publishes via the email API)
        templateId?  : string;
        onSaved?     : () => void;
        onDuplicate? : () => void;   // "Duplicate to edit" — shown when the loaded template is published (read-only)
        // DOCUMENT mode — the host owns persistence
        doc?         : EmailTemplate.Doc;
        subject?     : string;
        onDocChange? : ( doc : EmailTemplate.Doc, subject : string ) => void;
        // shared
        campaignId?  : string;   // image imports (browse/AI) are tagged to this campaign when present
        readOnly?    : boolean;
        onClose?     : () => void;
    }

    /** Sensible default props for a freshly-added block of `type`. */
    export function defaultProps( type : EmailTemplate.BlockType ) : Record<string, unknown>
    {
        if( type === EmailTemplate.BlockType.TEXT )   return { html: "<p>New text…</p>" };
        if( type === EmailTemplate.BlockType.IMAGE )  return { src: "", alt: "" };
        if( type === EmailTemplate.BlockType.BUTTON ) return { text: "Button", href: "https://", background: "#2563eb", color: "#ffffff" };
        if( type === EmailTemplate.BlockType.SPACER ) return { height: "20px" };
        if( type === EmailTemplate.BlockType.TABLE )  return { html: "<tr><td style=\"padding:6px;border:1px solid #dddddd;\">Cell</td></tr>" };
        if( type === EmailTemplate.BlockType.SOCIAL ) return { mode: "horizontal" };
        if( type === EmailTemplate.BlockType.HTML )   return { html: "<div></div>" };
        return {};
    }
}

export default EmailTemplateEditor;
// eof
