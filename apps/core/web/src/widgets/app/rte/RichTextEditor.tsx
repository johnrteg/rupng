//
import React from 'react';
import { JSX } from "react";
import { Theme, useTheme } from '@mui/material/styles';

//
import FormatBoldOutlinedIcon           from '@mui/icons-material/FormatBoldOutlined';
import FormatItalicOutlinedIcon         from '@mui/icons-material/FormatItalicOutlined';
import FormatUnderlinedOutlinedIcon     from '@mui/icons-material/FormatUnderlinedOutlined';
import StrikethroughSOutlinedIcon       from '@mui/icons-material/StrikethroughSOutlined';
import HighlightOutlinedIcon            from '@mui/icons-material/HighlightOutlined';
import FormatAlignLeftOutlinedIcon      from '@mui/icons-material/FormatAlignLeftOutlined';
import FormatAlignRightOutlinedIcon     from '@mui/icons-material/FormatAlignRightOutlined';
import FormatAlignCenterOutlinedIcon    from '@mui/icons-material/FormatAlignCenterOutlined';
import FormatAlignJustifyOutlinedIcon   from '@mui/icons-material/FormatAlignJustifyOutlined';
import HorizontalRuleOutlinedIcon       from '@mui/icons-material/HorizontalRuleOutlined';
import TypeSpecimenOutlinedIcon         from '@mui/icons-material/TypeSpecimenOutlined';
import UndoOutlinedIcon                 from '@mui/icons-material/UndoOutlined';
import RedoOutlinedIcon                 from '@mui/icons-material/RedoOutlined';
import SentimentSatisfiedOutlinedIcon   from '@mui/icons-material/SentimentSatisfiedOutlined';
import CodeOutlinedIcon                 from '@mui/icons-material/CodeOutlined';
import FormatColorTextOutlinedIcon      from '@mui/icons-material/FormatColorTextOutlined';
import AutoAwesomeOutlinedIcon          from '@mui/icons-material/AutoAwesomeOutlined';
import HtmlOutlinedIcon                 from '@mui/icons-material/HtmlOutlined';
import FormatLineSpacingOutlinedIcon    from '@mui/icons-material/FormatLineSpacingOutlined';
import KeyboardReturnOutlinedIcon       from '@mui/icons-material/KeyboardReturnOutlined';
import FormatListBulletedOutlinedIcon   from '@mui/icons-material/FormatListBulletedOutlined';
import FormatListNumberedOutlinedIcon   from '@mui/icons-material/FormatListNumberedOutlined';
import LocalOfferOutlinedIcon           from '@mui/icons-material/LocalOfferOutlined';
import EmojiSymbolsOutlinedIcon         from '@mui/icons-material/EmojiSymbolsOutlined';
import ClearOutlinedIcon                from '@mui/icons-material/ClearOutlined';
import AddLinkOutlinedIcon              from '@mui/icons-material/AddLinkOutlined';
import FormatClearOutlinedIcon          from '@mui/icons-material/FormatClearOutlined';
import TextFormatOutlinedIcon           from '@mui/icons-material/TextFormatOutlined';
import MicOffOutlinedIcon               from '@mui/icons-material/MicOffOutlined';
import MicNoneOutlinedIcon              from '@mui/icons-material/MicNoneOutlined';

//
//
import Text                 from '@tiptap/extension-text';
//import BulletList           from '@tiptap/extension-bullet-list';
import Document             from '@tiptap/extension-document';
//import ListItem             from '@tiptap/extension-list-item';
import { ListKit }          from '@tiptap/extension-list'
import Paragraph            from '@tiptap/extension-paragraph';
import Bold                 from '@tiptap/extension-bold';
import Italic               from '@tiptap/extension-italic';
import Underline            from '@tiptap/extension-underline';
import Strike               from '@tiptap/extension-strike';
import Highlight            from '@tiptap/extension-highlight';
//import Color                from '@tiptap/extension-color';
import { TextStyleKit, FontFamily }     from '@tiptap/extension-text-style';
import TextAlign            from '@tiptap/extension-text-align';
import HorizontalRule       from '@tiptap/extension-horizontal-rule';
import InvisibleCharacters  from '@tiptap/extension-invisible-characters';
import { UndoRedo }         from '@tiptap/extensions';   // v3: history consolidated into @tiptap/extensions
import Heading, { Level }   from '@tiptap/extension-heading';
import Code                 from '@tiptap/extension-code';
import HardBreak            from '@tiptap/extension-hard-break';
import { Link }             from '@tiptap/extension-link';
import { Placeholder }      from '@tiptap/extensions';   // v3: placeholder consolidated into @tiptap/extensions
import HighlightDecoration, { HIGHLIGHT_PLUGIN_KEY } from './HighlightDecoration';


//import { ListKit } from '@tiptap/extension-list';
//import { TaskItem, TaskList } from '@tiptap/extension-list';
import EmojiPicker, { EmojiStyle } from 'emoji-picker-react';


import { Editor, EditorContent, JSONContent, useEditor, useEditorState } from '@tiptap/react';
import { Box, CircularProgress, Popover, Stack } from '@mui/material';

import { StringUtils }          from '@repo/common';

import SelectInput              from '@widgets/core/SelectInput';
import HelpButton               from '@widgets/core/HelpButton';
import ColorPicker              from '@widgets/core/ColorPicker';
import VoiceToText              from '@utils/VoiceToText';
import Segments                 from '@utils/Segments';
import ButtonIconDropdown       from '@widgets/core/ButtonIconDropdown';

import MenuBarButton            from './MenuBarButton';
import MenuBarPopupButton       from './MenuBarPopupButton';
import MenuBarDivider           from './MenuBarDivider';
import TextAiPrompt             from './TextAiPrompt';
import RawHtmlEditor            from './RawHtmlEditor';
import MenuBarButtonDropdown    from './MenuBarButtonDropdown';
import RichTextEditorFooter     from './RichTextEditorFooter';
import LinkEditor               from './LinkEditor';
import UnicodeFonts             from './UnicodeFonts';

//
interface RichTextMenuBarProps
{
    editor                      : Editor | null;
    heading                     : string | null;
    size                        : string | null;
    insertTags?                 : Array<RichTextEditor.InsertTag>;
    toolbar?                    : Array<RichTextEditor.Tool>;
    aiFormats?                  : Array<TextAiPrompt.Format>;

    customMenuButtons?          : Array<RichTextEditor.CustomMenuButton>;
    customMenuRemoteButtons?    : Array<RichTextEditor.CustomMenuRemoteButton>;
    customButtons?              : Array<RichTextEditor.CustomButton>;

    progress?                   : boolean;

    help?                       : string;
    disabled?                   : boolean;
    maxChars?                   : number;
}

function RichTextMenuBar( props : RichTextMenuBarProps ) : JSX.Element | null
{
    const theme : Theme = useTheme();

    const [fontStyle, setFontStyle]                 = React.useState< string >( DEFAULT_FONT_TYPE );
    const [fontSize, setFontSize]                   = React.useState< string >( DEFAULT_FONT_SIZE );
    const [heading, setHeading]                     = React.useState< string >( props.heading ? props.heading : HEADING_NORMAL );
    const [tags, setTags]                           = React.useState< string >( RichTextEditor.INSERT_TAG_DEFAULT );
    const [emojiAnchor, setEmojiAnchor]             = React.useState<null | HTMLElement>(null);
    const [showAiEditor, setShowAiEditor]           = React.useState< boolean >( false );
    const [showLinkEditor, setShowLinkEditor]       = React.useState< string | undefined >( undefined );
    const [showRawEditor, setShowRawEditor]         = React.useState< boolean >( false );
    const [invisibleChars, setInvisibleChars]       = React.useState< boolean >( false );
    const [unicodeChars, setUnicodeChars]           = React.useState< boolean >( false );
    const [listening, setListening]                 = React.useState< boolean >( false );

    //
    const [disabled, setDisabled]                   = React.useState< boolean >( props.disabled ? props.disabled : false );

    //
    const voice                                     = React.useRef< VoiceToText | null >( null );
    const editorRef                                 = React.useRef< Editor | null >( null );
    editorRef.current                               = props.editor;   // keep latest editor for the once-created voice handler

    //
    React.useEffect( fontStyleChanged, [fontStyle] );
    React.useEffect( fontSizeChanged, [fontSize] );
    React.useEffect( headingUpdated, [props.heading] );
    React.useEffect( sizeUpdated, [props.size] );
    React.useEffect( headingChanged, [heading] );
    React.useEffect( tagsChanged, [tags] );
    React.useEffect( invisibleCharsChanged, [invisibleChars] );
    React.useEffect( disabledChanged, [props.disabled] );
    React.useEffect( setupVoice, [] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function fontStyleChanged() : void
    {
        if( props.editor )editor.chain().focus().setFontFamily( fontStyle ).run();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function fontSizeChanged() : void
    {
        if( props.editor )editor.chain().focus().setFontSize( fontSize ).run();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function disabledChanged() : void
    {
        setDisabled( props.disabled ? props.disabled : false );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // create the speech-to-text helper once ( when supported ); tear it down on unmount
    function setupVoice() : ( () => void ) | void
    {
        if( VoiceToText.isSupported() )
        {
            voice.current = new VoiceToText(
                { continuous: false, interimResults: false },
                {
                    onResult : ( spoken : string, isFinal : boolean ) => { if( isFinal )insertVoiceText( spoken ); },
                    onStart  : () => setListening( true ),
                    onEnd    : () => setListening( false ),
                    onError  : () => setListening( false )
                } );
        }

        return () => { if( voice.current ){ voice.current.dispose(); voice.current = null; } };
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onToggleVoice() : void
    {
        if( voice.current )voice.current.toggle();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // insert recognized speech at the cursor. reads editorRef ( not a closed-over editor ) so the
    // once-created voice handler always targets the live editor instance.
    function insertVoiceText( spoken : string ) : void
    {
        const ed    : Editor | null = editorRef.current;
        const piece : string = spoken.trim();
        if( ed === null || piece === "" )return;

        ed.chain().focus().insertContent( piece + " " ).run();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function invisibleCharsChanged() : void
    {
        editor.commands.showInvisibleCharacters( invisibleChars );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function headingUpdated() : void
    {
        setHeading( props.heading ? props.heading : HEADING_NORMAL );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function sizeUpdated() : void
    {
        setFontSize( props.size ? props.size : DEFAULT_FONT_SIZE );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function headingChanged() : void
    {
        if( props.editor == null )return;

        if( heading == HEADING_NORMAL )
        {
            props.editor.chain().focus().setNode('paragraph').run();
        }
        else
        {
            const level : Level = parseInt( heading ) as Level;
            props.editor.chain().focus().setNode('heading', { level }).run();
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function tagsChanged() : void
    {
        if( tags !== RichTextEditor.INSERT_TAG_DEFAULT && props.editor )
        {
            editor.chain().focus().insertContent( tags ).run();
            setTags( RichTextEditor.INSERT_TAG_DEFAULT );
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function openEmoji( anchor : null | HTMLElement ) : void
    {
        setEmojiAnchor( anchor );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function openAi() : void
    {
        setShowAiEditor( true );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function setFromOpenAi( new_text : TextAiPrompt.Text, format : TextAiPrompt.Format ) : void
    {
        editor.commands.setContent( ( format === TextAiPrompt.Format.HTML && new_text.html ) ? new_text.html : new_text.plain,
                                    { emitUpdate : true }  );
        setShowAiEditor( true );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onRawEdit() : void
    {
        setShowRawEditor( true );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function setFromRaw( new_text : string ) : void
    {
        editor.commands.setContent( new_text, { emitUpdate : true } );
        setShowRawEditor( false );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function onEmoji( selection : any ) : void
    {
        editor.chain().focus().insertContent( selection.emoji ).run();
        setEmojiAnchor( null );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function hasTool( tool : RichTextEditor.Tool ) : boolean
    {
        if( props.toolbar == undefined )
            return true;
        else
            return props.toolbar.indexOf( tool ) >= 0;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    function getColors() : Array<string>
    { 
        if( !props.editor )return [];
        const doc : JSONContent = props.editor.getJSON();
        //console.log(doc);
    
        const current_colors : Set<string> = new Set<string>();
    
        // not ideal
        function scan(node: any)
        {
            // Check marks for color
            if( node.marks )
            {
                node.marks.forEach((mark: any) => {
                    if( mark.attrs && mark.attrs.color )
                    {
                        current_colors.add(mark.attrs.color);
                    }
                });
            }
            // Check node attrs for color (e.g., textStyle extension)
            if( node.attrs && node.attrs.color )
            {
                current_colors.add(node.attrs.color);
            }
                
            // Recurse into content
            if( node.content )node.content.forEach( scan );
        }
    
        scan( doc );  // entry point
        return Array.from(current_colors);  
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onColorChange( color : string ) : void
    {
        if( props.editor )props.editor.chain().focus().setColor( color ).run();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onColorClear() : void
    {
        if( props.editor )props.editor.chain().focus().unsetColor().run();
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onLineSpace( value : string ) : void
    {
        editor.chain().focus().toggleTextStyle({ lineHeight: value }).run();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////
    function setUnicodeCharacters( flag : boolean ) : void
    {
        const html : string = editor.getHTML();

        if( flag )
        {
            // Regex for non-ASCII unicode characters
            // add tags around unicode characters
            const markedHtml : string = html.replace(/([^\x00-\x7F]+)/g, '<mark>$1</mark>');
            editor.commands.setContent( markedHtml, { emitUpdate: true });
        }
        else
        {
            const unmarkedHtml : string = html.replace(/<\/?mark>/g, '');
            editor.commands.setContent(unmarkedHtml, { emitUpdate: true });
        }

        setUnicodeChars( flag );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////
    function higlight( regex : RegExp | null ) : void
    {
        const html : string = editor.getHTML();

        if( regex )
        {
            const markedHtml : string = html.replace( regex, '<mark>$1</mark>');
            editor.commands.setContent( markedHtml, { emitUpdate: true });
        }
        else
        {
            const unmarkedHtml : string = html.replace(/<\/?mark>/g, '');
            editor.commands.setContent(unmarkedHtml, { emitUpdate: true });
        }
    }

    
    
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////
    function setUnicodeFontStyle( fontKey : string ) : void
    {
        const { from, to } = editor.state.selection;
        const selected : string = editor.state.doc.textBetween( from, to, " " );
        if( selected.length === 0 ) return;

        const converted : string = UnicodeFonts.applyFont( selected, fontKey );
        editor.chain().focus().deleteRange( { from, to } ).insertContentAt( from, converted ).run();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////
    function removeUnicode() : void
    {
        const { from, to } = editor.state.selection;
        if( from === to ) return;

        // Transform each text node within the selection in place ( rather than flattening the whole
        // range to one string ) so paragraph/line breaks and inline marks ( bold, italic, … ) survive.
        const edits : Array<{ from : number; to : number; text : string; marks : ReadonlyArray<any> }> = [];
        editor.state.doc.nodesBetween( from, to, ( node : any, pos : number ) =>
        {
            if( !node.isText || typeof node.text !== "string" ) return;

            const start  : number = Math.max( pos, from );
            const end    : number = Math.min( pos + node.text.length, to );
            if( end <= start ) return;

            const slice  : string = node.text.slice( start - pos, end - pos );
            const clean  : string = UnicodeFonts.removeAll( slice );
            if( clean !== slice ) edits.push( { from: start, to: end, text: clean, marks: node.marks } );
        } );
        if( edits.length === 0 ) return;

        // apply back-to-front so earlier offsets stay valid as the doc shrinks
        const tr : any = editor.state.tr;
        edits.sort( ( a, b ) => b.from - a.from ).forEach( ( e ) =>
        {
            if( e.text.length === 0 ) tr.delete( e.from, e.to );                                  // text nodes can't be empty
            else                      tr.replaceWith( e.from, e.to, editor.schema.text( e.text, e.marks ) );
        } );
        editor.view.dispatch( tr );
        editor.commands.focus();
    }

    

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function openLink() : void
    {
        const selected : string = editor.state.doc.textBetween( editor.state.selection.from, editor.state.selection.to, " " );
        setShowLinkEditor( selected );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onSetLink( text : string, url : string ) : void
    {
        const href : string = StringUtils.format( "<a href='{0}' target='_blank'>{1}</a>", url, text );
        editor.chain().focus().insertContent( href ).run();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onClear() : void
    {
        editor.commands.setContent( "", { emitUpdate: true });
    }

    // cache items for simplier reference
    if( !props.editor ) return null;
    const editor : Editor  = props.editor;
    

    // ========================================================================================================================
    return <Box
            sx={{
                border: '1px solid ' + ( theme.palette.mode === 'light' ? theme.darken( theme.palette.divider, 0.5 ) : theme.lighten( theme.palette.divider, 0.5 ) ),
                borderTopLeftRadius     : 6,
                borderTopRightRadius    : 6,
                borderBottomLeftRadius  : 0,
                borderBottomRightRadius : 0,
                borderBottom: 'none',
                mb: 0,                      // margin-bottom to separate from the editor box
                p: 0.5,                     // padding inside the menu bar
                background: theme.palette.background.default
            }}
        >
        <Stack direction="column" sx={ { p : 0.5 } } >
            <Stack direction="row" spacing={ 0.25 } sx={{ flexWrap: 'wrap', rowGap: 1 }}>

                { hasTool( RichTextEditor.Tool.VOICE_TO_TEXT ) ?
                    <MenuBarButton id="voice2text"   label={ listening ? "Stop Recording" : "Voice to Text" } disabled={ disabled } icon={ listening ? <MicOffOutlinedIcon/> : <MicNoneOutlinedIcon/> }  selected={ listening } onClick={ () => onToggleVoice() } />
                    : null }

                { hasTool( RichTextEditor.Tool.UNDO ) ?
                <Stack direction="row" spacing={ 0.25 }>
                    <MenuBarButton id="undo"   label={ "Undo" } disabled={ disabled } icon={ <UndoOutlinedIcon/> }  selected={ false } onClick={ () => editor.chain().focus().undo().run() } />
                    <MenuBarButton id="redo"   label={ "Redo" } disabled={ disabled } icon={ <RedoOutlinedIcon/> }  selected={ false } onClick={ () => editor.chain().focus().redo().run() } />
                    <MenuBarDivider />
                </Stack> : null }

                { hasTool( RichTextEditor.Tool.FONT ) ?
                <SelectInput id="font-style"
                            label="Font"
                            sx={ { width: 80 } }
                            disabled={ disabled } 
                            choices={ [ { value: 'Helvetica', label : 'Helvetica' },
                                        //{ value: 'Arial', label : 'Arial' },
                                        { value: 'Georgia', label : 'Georgia' },
                                        { value: 'Times', label : 'Times' },
                                        { value: 'Menlo', label : 'Menlo' },
                                        { value: 'Monaco', label : 'Monaco' },
                                        { value: 'Courier New', label : 'Courier New' },
                                        { value: 'system-ui', label : 'System' },
                                        { value: 'serif', label : 'Serif' },
                                        { value: 'monospace', label : 'Monospace' },
                                    ] } 
                            value={ fontStyle }
                            onChange={ setFontStyle } /> : null }

                { hasTool( RichTextEditor.Tool.SIZE ) ?
                <SelectInput id="font-size"
                            label="Size"
                            sx={ { width: 80 } }
                            disabled={ disabled } 
                            choices={ [  { value: '10px', label : '10' },
                                        { value: DEFAULT_FONT_SIZE, label : '11' },
                                        { value: '12px', label : '12' },
                                        { value: '14px', label : '14' },
                                        { value: '18px', label : '18' },
                                        { value: '24px', label : '24' },
                                        { value: '30px', label : '30' },
                                        { value: '36px', label : '36' },
                                        { value: '48px', label : '48' }
                                    ] } 
                            value={ fontSize }
                            onChange={ setFontSize } /> : null }

                { hasTool( RichTextEditor.Tool.STYLE ) ?
                <SelectInput id="style"
                            label="Style"
                            sx={ { width: 100 } }
                            disabled={ disabled } 
                            choices={ [  { value: HEADING_NORMAL, label : 'Normal' },
                                        { value: '1', label : 'Heading 1' },
                                        { value: '2', label : 'Heading 2' },
                                        { value: '3', label : 'Heading 3' },
                                        { value: '4', label : 'Heading 4' },
                                        { value: '5', label : 'Heading 5' },
                                        { value: '6', label : 'Heading 6' }
                                    ] } 
                            value={ heading }
                            onChange={ setHeading } /> : null }


                { hasTool( RichTextEditor.Tool.SIZE ) || hasTool( RichTextEditor.Tool.STYLE ) ?
                <MenuBarDivider /> : null }

                { hasTool( RichTextEditor.Tool.UNICODE_STYLE ) ?
                <Stack direction="row" spacing={ 0.25 }>
                    <MenuBarButtonDropdown  id="unicode-font"
                                            label={ "Unicode Style" }
                                            icon={ <TextFormatOutlinedIcon/> }
                                            disabled={ disabled }
                                            choices={ UnicodeFonts.CHOICES }
                                            onClick={ setUnicodeFontStyle } />
                    <MenuBarButton id="rmunicode"   label={ "Remove Unicode" } disabled={ disabled } icon={ <FormatClearOutlinedIcon/> }  selected={ false } onClick={ removeUnicode } />
                </Stack> : null }


                { hasTool( RichTextEditor.Tool.FORMAT ) ?
                <Stack direction="row" spacing={ 0.25 }>
                    <MenuBarButton id="bold"        label={ "Bold" } disabled={ disabled } icon={ <FormatBoldOutlinedIcon/> }      selected={ editor.isActive('bold') } onClick={ () => editor.chain().focus().toggleBold().run() } />
                    <MenuBarButton id="italic"      label={ "Italic" } disabled={ disabled } icon={ <FormatItalicOutlinedIcon/> }    selected={ editor.isActive('italic') } onClick={ () => editor.chain().focus().toggleItalic().run() } />
                    <MenuBarButton id="underline"   label={ "Underline" } disabled={ disabled } icon={ <FormatUnderlinedOutlinedIcon/> } selected={ editor.isActive('underline') } onClick={ () => editor.chain().focus().toggleUnderline().run() } />
                    <MenuBarButton id="strike"      label={ "Strikethough" } disabled={ disabled } icon={ <StrikethroughSOutlinedIcon/> }  selected={ editor.isActive('strike') } onClick={ () => editor.chain().focus().toggleStrike().run() } />
                    <MenuBarButton id="highlight"   label={ "Highlight" } disabled={ disabled } icon={ <HighlightOutlinedIcon/> }       selected={ editor.isActive('highlight') } onClick={ () => editor.chain().focus().toggleHighlight().run() } />
                    
                    <ColorPicker    id="text-color"
                                    label={"Text Color"}
                                    icon={ <FormatColorTextOutlinedIcon />}
                                    disabled={ disabled } 
                                    choices={ getColors() }
                                    selected={ props.editor.getAttributes('textStyle').color ? true : false }
                                    value={ props.editor.getAttributes('textStyle').color || '#000000' }
                                    onChange={ onColorChange }
                                    onClear={ onColorClear }  />

                    {/* <MenuBarButton  id="unset-color"   icon={ <FormatColorResetOutlinedIcon/> } selected={ editor.getAttributes('textStyle').color } onClick={ () => editor.chain().focus().unsetColor().run() } /> */ }
                    <MenuBarButton  id="code"          label={ "Code" } disabled={ disabled } icon={ <CodeOutlinedIcon/> }             selected={ editor.isActive('code') } onClick={ () => editor.chain().focus().toggleCode().run()} />

                <MenuBarDivider />
                </Stack> : null }

                { hasTool( RichTextEditor.Tool.ALIGNMENT ) ?
                <Stack direction="row" spacing={ 0.25 }>
                    <MenuBarButton  id="align-left"     label={ "Align Left" } disabled={ disabled } icon={ <FormatAlignLeftOutlinedIcon /> } selected={ editor.isActive({ textAlign: 'left' }) } onClick={ () => editor.chain().focus().setTextAlign('left').run() } />
                    <MenuBarButton  id="align-center"   label={ "Align Center" } disabled={ disabled } icon={ <FormatAlignCenterOutlinedIcon/> } selected={ editor.isActive({ textAlign: 'center' }) } onClick={ () => editor.chain().focus().setTextAlign('center').run() } />
                    <MenuBarButton  id="align-right"    label={ "Align Right" } disabled={ disabled } icon={ <FormatAlignRightOutlinedIcon/> } selected={ editor.isActive({ textAlign: 'right' }) } onClick={ () => editor.chain().focus().setTextAlign('right').run() } />
                    <MenuBarButton  id="align-justify"  label={ "Align Justified" } disabled={ disabled } icon={ <FormatAlignJustifyOutlinedIcon/> } selected={ editor.isActive({ textAlign: 'justify' }) } onClick={ () => editor.chain().focus().setTextAlign('justify').run() } />

                    <MenuBarDivider />
                </Stack> : null }

                { hasTool( RichTextEditor.Tool.HORIZONTAL ) ?
                <MenuBarButton  id="horz-rule"   label={ "Horizontal Line" } disabled={ disabled } icon={ <HorizontalRuleOutlinedIcon/> } selected={ false } onClick={ () => editor.chain().focus().setHorizontalRule().run() } />
                : null }


                { hasTool( RichTextEditor.Tool.BULLETS ) ?
                <Stack direction="row" spacing={ 0.25 }>
                    <MenuBarButtonDropdown  id="line-spacing"   label={ "Line Spacing" }
                                            icon={ <FormatLineSpacingOutlinedIcon/> }
                                            disabled={ disabled } 
                                            choices={ [ { value : "1", label: "Single" },
                                                        { value : "1.15", label: "1.15" },
                                                        { value : "1.5", label: "1.5" },
                                                        { value : "2.0", label: "Double" }
                                                    ] }
                                            onClick={ onLineSpace } />
                    
                    <MenuBarButton  id="bullet-list"   label={ "Bulletted List" } icon={ <FormatListBulletedOutlinedIcon/> }
                                    selected={ editor.isActive('bulletList') }
                                    disabled={ disabled } 
                                    onClick={ () => editor.chain().focus().toggleBulletList().run() } />
                    <MenuBarButton  id="ordered-list"   label={ "Ordered List" } icon={ <FormatListNumberedOutlinedIcon/> }
                                    selected={ editor.isActive('orderedList') }
                                    disabled={ disabled } 
                                    onClick={ () => editor.chain().focus().toggleOrderedList().run() } />
                    <MenuBarDivider />
                </Stack> : null }

                { hasTool( RichTextEditor.Tool.BREAK ) ?
                <MenuBarButton  id="hard-break"   label={ "Hard Break" } icon={ <KeyboardReturnOutlinedIcon/> }
                                        selected={ false }
                                        disabled={ disabled } 
                                        onClick={ () => editor.chain().focus().setHardBreak().run() } /> : null}

                { hasTool( RichTextEditor.Tool.HTML ) ?
                <MenuBarPopupButton  id="raw"   label={ "View Raw HTML" + StringUtils.ELLIPSE } disabled={ disabled } icon={ <HtmlOutlinedIcon/> } selected={ false } onClick={ onRawEdit } />
                : null}

                { hasTool( RichTextEditor.Tool.HIDDEN ) ?
                <Stack direction="row" spacing={ 0.25 }>
                    <MenuBarButton  id="hidden"   label={ "Show Hidden Characters" } disabled={ disabled } icon={ <TypeSpecimenOutlinedIcon/> } selected={ invisibleChars } onClick={ () => setInvisibleChars( !invisibleChars ) } />
                    <MenuBarButton  id="unicode"   label={ "Show Unicode Characters" } disabled={ disabled } icon={ <EmojiSymbolsOutlinedIcon/> } selected={ unicodeChars } onClick={ () => setUnicodeCharacters( !unicodeChars ) } />
                </Stack> : null }

                { hasTool( RichTextEditor.Tool.LINK ) ?
                <MenuBarPopupButton  id="link"   label={ "Link" + StringUtils.ELLIPSE } icon={ <AddLinkOutlinedIcon/> } selected={ false } onClick={ openLink } />
                : null }

                { hasTool( RichTextEditor.Tool.EMOJI ) ?
                <MenuBarPopupButton  id="emoji"   label={ "Emojis" + StringUtils.ELLIPSE } disabled={ disabled } icon={ <SentimentSatisfiedOutlinedIcon/> } selected={ false } onClick={ openEmoji } />
                : null }

                { hasTool( RichTextEditor.Tool.AI ) ?
                <MenuBarPopupButton  id="ai"   label={ "AI Assistant" + StringUtils.ELLIPSE } disabled={ disabled } icon={ <AutoAwesomeOutlinedIcon/> } selected={ false } onClick={ openAi } />
                : null }

                { hasTool( RichTextEditor.Tool.CLEAR ) ?
                <MenuBarPopupButton  id="clear"   label={ "Clear" } disabled={ disabled } icon={ <ClearOutlinedIcon/> } selected={ false } onClick={ onClear } />
                : null }

                { /* -------------------------------------- custom menu buttons -------------------------------------- */ }
                { props.customMenuButtons !== undefined && props.customMenuButtons.length > 0 ?
                props.customMenuButtons.map( ( cbtn : RichTextEditor.CustomMenuButton ) => {
                    return <MenuBarButtonDropdown   id={ cbtn.value } key={ cbtn.value }
                                                    label={ cbtn.label }
                                                    icon={ cbtn.icon }
                                                    disabled={ disabled } 
                                                    choices={ cbtn.choices }
                                                    onClick={ ( cvalue : string ) =>
                                                    { 
                                                        if( cbtn.text === "replace" )
                                                            editor.commands.setContent( cvalue, { emitUpdate: true });
                                                        else
                                                            editor.commands.insertContent( cvalue + " " );

                                                        if( cbtn.onComplete !== undefined )cbtn.onComplete( cvalue );
                                                    } } />
                } )
                : null }

                { /* -------------------------------------- custom remote menu buttons -------------------------------------- */ }
                { props.customMenuRemoteButtons !== undefined && props.customMenuRemoteButtons.length > 0 ?
                props.customMenuRemoteButtons.map( ( cbtn : RichTextEditor.CustomMenuRemoteButton ) => {
                    return <MenuBarButtonDropdown   id={ cbtn.value } key={ cbtn.value }
                                                    label={ cbtn.label }
                                                    icon={ cbtn.icon }
                                                    disabled={ disabled } 
                                                    choices={ cbtn.choices }
                                                    onClick={ ( cvalue : string ) => { cbtn.onChange( cvalue ) } } />
                } )
                : null }

                { /* -------------------------------------- custom remote buttons -------------------------------------- */ }
                { props.customButtons !== undefined && props.customButtons.length > 0 ?
                props.customButtons.map( ( cbtn : RichTextEditor.CustomButton ) => {
                    return <MenuBarButton   id={ cbtn.value }
                                            key={ cbtn.value }
                                            label={ cbtn.label }
                                            icon={ cbtn.icon }
                                            selected={ false }
                                            disabled={ disabled } 
                                            onClick={ cbtn.onClick }
                                            onClickRaw={ cbtn.onClickRaw }
                                        />
                } )
                : null }

                { /* -------------------------------------- insert tags -------------------------------------- */ }
                { props.insertTags != undefined ? 
                    <MenuBarButtonDropdown  id="tag-inserts"   label={ "Insert Tags" }
                                                icon={ <LocalOfferOutlinedIcon/> }
                                                choices={ props.insertTags }
                                                disabled={ disabled } 
                                                onClick={ setTags } />
                 : null }

                { props.help != undefined ? <HelpButton id="help" value={ props.help } /> : null }

                { /* -------------------------------------- popups -------------------------------------- */ }
                { emojiAnchor ? <Popover
                                    open={ true }
                                    anchorEl={ emojiAnchor }
                                    onClose={ ()=>setEmojiAnchor( null ) }
                                    anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
                                    transformOrigin={{ vertical: 'top', horizontal: 'center' }}
                                >
                                    <EmojiPicker    onEmojiClick={ onEmoji }
                                                    emojiStyle={ EmojiStyle.APPLE }
                                                    //theme={ 'auto' }
                                                    />
                                </Popover> : null }

                { /* -------------------------------------- progress -------------------------------------- */ }
                { props.progress !== undefined && props.progress ? <Box sx={ { pt: 1, pl: 0.5 } }><CircularProgress size="24px" /></Box> : null }
                

                
            </Stack>
        </Stack>

        { showAiEditor ? <TextAiPrompt value={ { plain: editor.getText(), html: editor.getHTML() } }
                                        formats={ props.aiFormats !== undefined ? props.aiFormats : [TextAiPrompt.Format.PLAIN,TextAiPrompt.Format.HTML] }
                                        maxLength={ props.maxChars }
                                        onClose={ () => setShowAiEditor( false ) }
                                        onSaved={ setFromOpenAi } /> : null }

        { showRawEditor ? <RawHtmlEditor value={ editor.getHTML() }
                                        onClose={ () => setShowRawEditor( false ) }
                                        onSaved={ setFromRaw } /> : null }

        { showLinkEditor !== undefined ? <LinkEditor value={ showLinkEditor }
                                        onClose={ () => setShowLinkEditor( undefined ) }
                                        onSaved={ onSetLink } /> : null }
    </Box>;
}



const HEADING_NORMAL    : string = "normal";
const DEFAULT_FONT_SIZE : string = "11px";
const DEFAULT_FONT_TYPE : string = "helvetica";


//
// =============================================================================================
//


export function RichTextEditor( props : RichTextEditor.Props ) : JSX.Element
{
    const theme : Theme = useTheme();

    const [heading, setHeading]     = React.useState< string | null >( HEADING_NORMAL );
    const [size, setSize]           = React.useState< string | null >( null );

    const editor = useEditor( {
                                    extensions: [Document, Paragraph, Text,
                                                //BulletList, ListItem,
                                                Italic, Bold, Underline, Strike,
                                                Highlight.configure({ multicolor: true }),
                                                //Color,
                                                //LineHeight,
                                                HardBreak,
                                                TextStyleKit,
                                                //FontFamily,
                                                ListKit,
                                                Code,
                                                Link.configure( { openOnClick: true } ),
                                                TextAlign.configure( { types: ['heading', 'paragraph'] } ),
                                                Heading.configure( { levels: [ 1, 2, 3, 4, 5, 6 ] } ),
                                                HorizontalRule,
                                                InvisibleCharacters,
                                                UndoRedo,
                                                Placeholder.configure({
                                                    placeholder: props.placeHolder ?? ""
                                                }),
                                                HighlightDecoration,
                                                ],
                                    editable: props.editable === undefined || props.editable ? true : true,
                                    content: props.value,
                                });

    React.useEffect( () => componentLoaded(), [] );
    React.useEffect( () => () => componentUnloaded(), [] );
    React.useEffect( propsValueChanged, [props.value] );
    React.useEffect( disabledChanged, [editor,props.disabled] );
    React.useEffect( highlightChanged, [props.highlight] );

    

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function componentLoaded() : void
    {
        if( editor === null )return;

        
        if( props.editable !== undefined && props.editable === false )
        {
            editor.setEditable( false );
        }
        else
        {
            editor.on( 'selectionUpdate', onSelection );
            if( props.maxChars !== undefined )editor.on('update', onLimit );
            if( props.onChange !== undefined || props.onPlainChange !== undefined )editor.on('update', onChange );
            onSelection(); // init
        }
        editor.commands.showInvisibleCharacters( false );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function componentUnloaded() : void
    {
        if( editor && ( props.editable == undefined || props.editable === true  ) )
        {
            editor.off( 'selectionUpdate', onSelection );
            if( props.maxChars !== undefined )editor.off('update', onLimit );
            if( props.onChange !== undefined || props.onPlainChange !== undefined )editor.off('update', onChange );
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    // Dispatch regex to the decoration plugin — never touches the document or cursor
    function applyHighlight( regex : RegExp | null | undefined ) : void
    {
        if( !editor ) return;
        editor.view.dispatch(
            editor.view.state.tr.setMeta( HIGHLIGHT_PLUGIN_KEY, regex ?? null )
        );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function highlightChanged() : void
    {
        applyHighlight( props.highlight );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function propsValueChanged() : void
    {
        if( editor && (    ( props.onChange      !== undefined && props.value !== editor.getHTML() ) 
                        || ( props.onPlainChange !== undefined && props.value !== editor.getText() )
                        || ( props.onChange === undefined && props.onPlainChange === undefined ) ) )
        {
            editor.commands.setContent( props.value, { emitUpdate : true } );
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function onLimit() : void
    {
        if( editor
            && props.maxChars !== undefined
            && editor.getText().length > props.maxChars
            && ( props.trancateMax === undefined || props.trancateMax ) )
        {
            // Undo the last transaction (prevents extra input)
            //editor.commands.undo();
            const truncated : string = editor.getText().slice( 0 , props.maxChars );
            editor.commands.setContent( truncated, { emitUpdate : true } );
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function onChange() : void
    {   
        if( editor )
        {
            if( props.onChange      !== undefined )props.onChange( editor.getHTML() );
            if( props.onPlainChange !== undefined )props.onPlainChange( editor.getText() );
        }  
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////
    function disabledChanged() : void
    {   
        if( editor && ( props.editable === null || props.editable === true ) )
        {
            editor.setEditable( !(props.disabled ?? false) );
        }  
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function onSelection() : void
    {
        if( editor == null )return;

        // heading
        const attrs : any = editor.getAttributes( 'heading' );
        setHeading( attrs.level ? attrs.level : HEADING_NORMAL );

        // font size
        const textStyleAttrs = editor.getAttributes( 'textStyle' );
        setSize( textStyleAttrs.fontSize ? textStyleAttrs.fontSize : DEFAULT_FONT_SIZE );
    }


    // ============================================================================================
    const editable : boolean = props.editable == undefined || props.editable;

    // no padding along the bottom
    return  <Stack direction="column" spacing={ 0 } sx={ { height : props.height, '& > :last-child': { paddingBottom: 0 }, flex: 1 } } >

                { editable ? <RichTextMenuBar
                                    editor={ editor }
                                    size={ size }
                                    heading={ heading }
                                    help={ props.help }
                                    toolbar={ props.toolbar }
                                    insertTags={ props.insertTags }
                                    disabled={ props.disabled }
                                    customMenuButtons={ props.customMenuButtons }
                                    customMenuRemoteButtons={ props.customMenuRemoteButtons }
                                    customButtons={ props.customButtons }
                                    aiFormats={ props.aiFormats }
                                    progress={ props.progress }
                                    maxChars={ props.maxChars }
                                /> : null }

                <Box sx={{ p: 1, border: ( props.noBorder === undefined || props.noBorder === false ) ? ( "1px solid " + theme.palette.divider ) : undefined,

                                borderTopLeftRadius    : editable ? 0 : 6,
                                borderTopRightRadius   : editable ? 0 : 6,
                                borderBottomLeftRadius : props.maxChars !== undefined ? 0 : 6,
                                borderBottomRightRadius: props.maxChars !== undefined ? 0 : 6,

                                background: ( props.sx && props.sx.backgroundColor ) ? props.sx.backgroundColor : theme.palette.background.paper,

                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'stretch',
                                overflow: 'auto' }}>

                    <EditorContent className="richtext-editor-content"
                                    //disabled={ props.disabled !== undefined ? props.disabled : false }
                                    style={{
                                            backgroundColor : ( props.sx && props.sx.backgroundColor ) ? props.sx.backgroundColor : theme.palette.background.paper,
                                            color           : ( props.sx && props.sx.textColor ) ? props.sx.textColor : theme.palette.text.primary,
                                            minHeight       : props.minHeight !== undefined ? props.minHeight : undefined,
                                        }}
                                    editor={ editor } />
                </Box>

                { editable && props.maxChars !== undefined ?
                    <RichTextEditorFooter editor={ editor }
                                        maxChars={ props.maxChars }
                                        showUnicodeCount={ props.showUnicodeCount }
                                        additionalTextCount={ props.additionalTextCount }
                                        thresholds={ props.thresholds } /> : null }

                    
            </Stack>;
}

// ====================================================================================================
//
//
export namespace RichTextEditor
{
    export const INSERT_TAG_DEFAULT : string = "-";

    export enum Tool
    {
        VOICE_TO_TEXT = "voice_to_text",
        UNDO        = "undo",
        SIZE        = "size",
        FONT        = "font",
        STYLE       = "style",
        FORMAT      = "format",
        BULLETS     = "bullets",
        CODE        = "code",
        ALIGNMENT   = "align",
        HORIZONTAL  = "horiz",
        HIDDEN      = "hidden",
        HTML        = "html",
        BREAK       = "break",
        EMOJI       = "emoji",
        AI          = "ai",
        LINK        = "link",
        CLEAR       = "clear",
        UNICODE_STYLE   = "unicode_style",
        UNICODE_REMOVE   = "unicode_remove"
    }

    export interface CustomButton
    {
        value           : string;
        label           : string;
        icon            : JSX.Element;
        onClick?        : () => Promise<void>;
        onClickRaw?     : ( event : React.MouseEvent<HTMLButtonElement> ) => void;
    }

    export interface CustomMenuButton
    {
        value       : string;
        label       : string;
        icon        : JSX.Element;
        choices     : Array<ButtonIconDropdown.Choice>;
        text        : "replace" | "insert";
        onComplete? : ( value : string ) => void;
    }

    //
    // custom buttons that do not change the content
    // but are used to call back to the parent usage of
    // the editor
    //
    export interface CustomMenuRemoteButton extends CustomMenuButton
    {
        onChange : ( value : string ) => void;
    }

    export interface InsertTag extends MenuBarButtonDropdown.Choice
    {
    }


    export interface Props
    {
        id                          : string
        value                       : string;
        height?                     : number;
        editable?                   : boolean;
        insertTags?                 : Array<RichTextEditor.InsertTag>;
        toolbar?                    : Array<RichTextEditor.Tool>;
        help?                       : string;
        maxChars?                   : number;
        minHeight?                  : number;
        trancateMax?                : boolean;
        thresholds?                 : Segments;
        showUnicodeCount?           : boolean;
        placeHolder?                : string;
        noBorder?                   : boolean;
        disabled?                   : boolean;
        aiFormats?                  : Array<TextAiPrompt.Format>;

        highlight?                  : RegExp | null;

        additionalTextCount?        : string;   // add in for text counting

        customMenuButtons?          : Array<CustomMenuButton>;
        customMenuRemoteButtons?    : Array<CustomMenuRemoteButton>;
        customButtons?              : Array<CustomButton>;

        progress?                   : boolean;

        sx?                         : { backgroundColor?: string, textColor?: string };

        onChange?                   : ( text : string ) => void;
        onPlainChange?              : ( text : string ) => void;
    }
}


export default RichTextEditor;

// eof