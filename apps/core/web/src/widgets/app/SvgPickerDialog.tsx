import React from 'react';
import { JSX } from "react";

import { Box, Button, Chip, Stack, TextField, Typography } from "@mui/material";

import { Account } from '@repo/api';

import DialogWindow from '@widgets/core/DialogWindow';
import TextInput    from '@widgets/core/TextInput';
import { SVG_CATALOG, type SvgEntry, svgDataUrl, looksLikeSvg, extractSvg, toBrandSvg } from '@widgets/core/SvgCatalog';

//
// SvgPickerDialog — choose the theme's brand graphics: browse the app SVG catalog (click a tile to toggle) or
// PASTE your own SVG markup (BYO). Edits a LOCAL DRAFT; "Set" commits (via onChange), "Cancel" discards. Selected
// graphics sit at the top for reference + removal. SVGs are stored as inline markup so they can be recolored to
// the brand palette when placed in an editor.
//
export function SvgPickerDialog( props : SvgPickerDialog.Props ) : JSX.Element
{
    const [draft,setDraft]         = React.useState< Array<Account.BrandSvg> >( props.value );
    const [pasteName,setPasteName] = React.useState< string >( "" );
    const [pasteSvg,setPasteSvg]   = React.useState< string >( "" );
    const fileInputRef             = React.useRef< HTMLInputElement | null >( null );

    const selectedNames : Set<string> = new Set( draft.map( ( item : Account.BrandSvg ) : string => item.name ) );
    const pasteValid : boolean = pasteName.trim() !== "" && looksLikeSvg( pasteSvg );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // toggle a catalog entry in/out of the draft
    function toggleCatalog( entry : SvgEntry ) : void
    {
        if( selectedNames.has( entry.name ) ) setDraft( draft.filter( ( item : Account.BrandSvg ) : boolean => item.name !== entry.name ) );
        else setDraft( [ ...draft, toBrandSvg( entry ) ] );
    }

    // remove a graphic by name
    function remove( name : string ) : void
    {
        setDraft( draft.filter( ( item : Account.BrandSvg ) : boolean => item.name !== name ) );
    }

    // add the pasted (BYO) SVG to the draft, then clear the paste fields (extract the <svg> element so a leading
    // <?xml?>/DOCTYPE from a downloaded file is stripped)
    function addPasted() : void
    {
        const svg : string | null = extractSvg( pasteSvg );
        if( pasteName.trim() === "" || svg === null ) return;
        setDraft( [ ...draft, { name: pasteName.trim(), svg } ] );
        setPasteName( "" );
        setPasteSvg( "" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // import dropped / chosen .svg FILE(s) — read each as text, extract the <svg>, add with the filename as name
    function onDrop( event : React.DragEvent<HTMLDivElement> ) : void
    {
        event.preventDefault();
        Array.from( event.dataTransfer.files ).forEach( readSvgFile );
    }

    function onFilePick( event : React.ChangeEvent<HTMLInputElement> ) : void
    {
        Array.from( event.target.files ?? [] ).forEach( readSvgFile );
        event.target.value = "";   // allow re-picking the same file
    }

    function readSvgFile( file : File ) : void
    {
        const reader : FileReader = new FileReader();
        reader.onload = () : void => addSvgText( file.name, String( reader.result ) );
        reader.readAsText( file );
    }

    // add SVG text from a file (functional update — several files may resolve at once)
    function addSvgText( fileName : string, text : string ) : void
    {
        const svg : string | null = extractSvg( text );
        if( svg === null ) return;
        const name : string = fileName.replace( /\.svg$/i, "" );
        setDraft( ( prev : Array<Account.BrandSvg> ) : Array<Account.BrandSvg> => [ ...prev, { name, svg } ] );
    }

    // "Set" — commit the draft
    async function onSet() : Promise<boolean>
    {
        props.onChange( draft );
        return true;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="svg-picker"
                          title={"Brand graphics"}
                          yesLabel={"Set"}
                          cancelLabel={"Cancel"}
                          minWidth="sm"
                          onYes={ onSet }
                          onClose={ props.onClose }>
                <Stack spacing={ 1.5 } sx={{ p: 2 }}>

                    {/* SELECTED */}
                    <Box>
                        <Typography variant="caption" sx={{ color: "text.secondary" }}>{ `Selected (${ draft.length })` }</Typography>
                        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: 0.5 }}>
                            { draft.length === 0 ? <Typography variant="body2" sx={{ color: "text.secondary" }}>{"None yet — pick from the catalog or paste your own."}</Typography> : null }
                            { draft.map( ( item : Account.BrandSvg ) : JSX.Element => (
                                <Chip key={ item.name } label={ item.name } onDelete={ () : void => remove( item.name ) } variant="outlined" /> ) ) }
                        </Box>
                    </Box>

                    {/* CATALOG */}
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>{"Catalog"}</Typography>
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                        { SVG_CATALOG.map( ( entry : SvgEntry ) : JSX.Element => (
                            <Box key={ entry.name }
                                 title={ entry.name }
                                 onClick={ () : void => toggleCatalog( entry ) }
                                 sx={{ width: 60, height: 60, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 0.25, p: 0.5, borderRadius: 1, cursor: "pointer",
                                       border: 1, borderColor: selectedNames.has( entry.name ) ? "primary.main" : "divider",
                                       bgcolor: selectedNames.has( entry.name ) ? "action.selected" : "transparent" }}>
                                <Box component="img" src={ svgDataUrl( entry.svg ) } alt={ entry.name } sx={{ width: 28, height: 28 }} />
                                <Typography variant="caption" noWrap sx={{ fontSize: 9, maxWidth: 54 }}>{ entry.name }</Typography>
                            </Box> ) ) }
                    </Box>

                    {/* BYO — drop / import a file */}
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>{"Import your own SVG"}</Typography>
                    <Box onDragOver={ ( event : React.DragEvent<HTMLDivElement> ) : void => event.preventDefault() }
                         onDrop={ onDrop }
                         onClick={ () : void => fileInputRef.current?.click() }
                         sx={{ border: "1px dashed", borderColor: "divider", borderRadius: 1, p: 2, textAlign: "center", cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}>
                        <Typography variant="body2" sx={{ color: "text.secondary" }}>{"Drop an .svg file here, or click to choose"}</Typography>
                        <input ref={ fileInputRef } type="file" accept=".svg,image/svg+xml" multiple hidden onChange={ onFilePick } />
                    </Box>

                    {/* BYO — paste markup */}
                    <TextInput id="svg-paste-name" label={"Name (for pasted markup)"} value={ pasteName } fullWidth onChange={ setPasteName } />
                    <TextField label={"SVG markup"} value={ pasteSvg } onChange={ ( event : React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement> ) : void => setPasteSvg( event.target.value ) } multiline minRows={ 3 } fullWidth size="small" />
                    <Button size="small" variant="outlined" disabled={ !pasteValid } onClick={ addPasted } sx={{ alignSelf: "flex-start" }}>{"Add pasted SVG"}</Button>
                </Stack>
            </DialogWindow>;
}

export namespace SvgPickerDialog
{
    export interface Props
    {
        value    : Array<Account.BrandSvg>;                        // the theme's current brand graphics (draft seed)
        onChange : ( svgs : Array<Account.BrandSvg> ) => void;     // committed on "Set"
        onClose  : () => void;                                     // "Cancel" — discard draft
    }
}

export default SvgPickerDialog;
// eof
