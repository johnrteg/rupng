import { JSX } from "react";

import { Box, Chip, Divider, Stack, Typography } from "@mui/material";

import { Account, EmailTemplate } from '@repo/api';

import AppModel     from "@model/AppModel";
import TextInput    from '@widgets/core/TextInput';
import SelectMultInput from '@widgets/core/SelectMultInput';
import CodeEditorInput from '@widgets/core/CodeEditorInput';
import ColorPicker  from '@widgets/core/ColorPicker';
import WebFontListEditor from '@widgets/email/WebFontListEditor';
import { EMAIL_COLORS, FONT_CHOICES, fontStackToList, fontListToStack } from '@widgets/email/editor/EmailEditorModel';

//
// EmailDocumentSettings — the document-level settings panel (canvas width / background / base font stack, and
// the head: title, inbox preview, mobile breakpoint, web-font imports, custom CSS). Controlled: the host owns
// the doc + persistence and patches via `onPatchSettings` / `onPatchHead`.
//
export function EmailDocumentSettings( props : EmailDocumentSettings.Props ) : JSX.Element
{
    const doc : EmailTemplate.Doc = props.doc;
    const readOnly : boolean = props.readOnly === true;
    const head : EmailTemplate.Head = doc.head ?? {};
    const fonts : Array<EmailTemplate.FontDef> = head.fonts ?? [];

    // base-font choices = the web-safe stacks + the account's BRAND fonts + this template's imported fonts
    // (deduped) — so brand fonts are pickable as the base family. (Import a brand font below to embed it so it
    // actually renders in the sent email; picking one here that isn't imported falls back for recipients.)
    const brandFonts : Array<Account.BrandFont> = AppModel.instance().account.fonts ?? [];
    const extraNames : Array<string> = [ ...brandFonts.map( ( font : Account.BrandFont ) : string => font.name ), ...fonts.map( ( font : EmailTemplate.FontDef ) : string => font.name ) ];
    const seenNames : Set<string> = new Set( FONT_CHOICES.map( ( choice : SelectMultInput.Choice ) : string => String( choice.value ) ) );
    const fontChoices : Array<SelectMultInput.Choice> = [ ...FONT_CHOICES ];
    for( const name of extraNames )
    {
        if( name === "" || seenNames.has( name ) ) continue;
        seenNames.add( name );
        fontChoices.push( { value: name, label: name } );
    }

    // parse the canvas width field (ignore a non-numeric value)
    function onWidth( value : string ) : void { const width : number = Number( value ); if( !Number.isNaN( width ) ) props.onPatchSettings( { width } ); }

    return <Stack spacing={ 2 } sx={{ p: 2 }}>
        <Typography variant="subtitle2">{"Document settings"}</Typography>
        <TextInput id="doc-width" label={"Canvas width (px)"} value={ String( doc.settings.width ?? 600 ) } fullWidth disabled={ readOnly } onChange={ onWidth } />
        <ColorPicker id="doc-bg" label={"Background color"} value={ String( doc.settings.backgroundColor ?? "#f4f4f4" ) } choices={ EMAIL_COLORS } disabled={ readOnly } onChange={ ( color : string ) : void => props.onPatchSettings( { backgroundColor: color } ) } />
        <SelectMultInput id="doc-font" label={"Base font family (stack)"} value={ fontStackToList( String( doc.settings.fontFamily ?? "" ) ) } choices={ fontChoices } minWidth="100%" disabled={ readOnly } onChange={ ( families : Array<string> ) : void => props.onPatchSettings( { fontFamily: fontListToStack( families ) } ) } />

        <Typography variant="overline" sx={{ color: "text.secondary" }}>{"Head"}</Typography>
        <TextInput id="doc-title" label={"Title"} value={ String( head.title ?? "" ) } fullWidth disabled={ readOnly } onChange={ ( value : string ) : void => props.onPatchHead( { title: value } ) } />
        <TextInput id="doc-preview" label={"Inbox preview text"} value={ String( head.preview ?? "" ) } fullWidth multiline maxRows={ 2 } disabled={ readOnly } onChange={ ( value : string ) : void => props.onPatchHead( { preview: value } ) } />
        <TextInput id="doc-breakpoint" label={"Mobile breakpoint (e.g. 480px)"} value={ String( head.breakpoint ?? "" ) } fullWidth disabled={ readOnly } onChange={ ( value : string ) : void => props.onPatchHead( { breakpoint: value } ) } />

        {/* imported web fonts — add / edit / drag to reorder (priority order) */}
        <Divider textAlign="left"><Typography variant="caption" sx={{ color: "text.secondary" }}>{"Web fonts"}</Typography></Divider>

        {/* one-click import of the account's brand fonts (only those not already imported) */}
        { !readOnly && brandFonts.length > 0 ?
            <Box>
                <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 0.5 }}>{"Add a brand font:"}</Typography>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                    { brandFonts
                        .filter( ( bf : Account.BrandFont ) : boolean => !fonts.some( ( f : EmailTemplate.FontDef ) : boolean => f.name === bf.name ) )
                        .map( ( bf : Account.BrandFont ) : JSX.Element => (
                            <Chip key={ bf.name } size="small" variant="outlined" label={ bf.name }
                                  onClick={ () : void => props.onPatchHead( { fonts: [ ...fonts, { name: bf.name, href: bf.href } ] } ) } /> ) ) }
                </Box>
            </Box> : null }

        <WebFontListEditor fonts={ fonts } readOnly={ readOnly } onChange={ ( next : Array<EmailTemplate.FontDef> ) : void => props.onPatchHead( { fonts: next } ) } />
        <CodeEditorInput id="doc-css" label={"Custom CSS"} value={ ( head.styles ?? [] ).join( "\n\n" ) } editable={ !readOnly } format="css" onChange={ ( css : string ) : void => props.onPatchHead( { styles: css.trim() === "" ? [] : [ css ] } ) } />
    </Stack>;
}

export namespace EmailDocumentSettings
{
    export interface Props
    {
        doc             : EmailTemplate.Doc;
        readOnly?       : boolean;
        onPatchSettings : ( patch : Partial<EmailTemplate.DocSettings> ) => void;
        onPatchHead     : ( patch : Partial<EmailTemplate.Head> ) => void;
    }
}

export default EmailDocumentSettings;
// eof
