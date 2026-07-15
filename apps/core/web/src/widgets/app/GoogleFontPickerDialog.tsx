import React from 'react';
import { JSX } from "react";

import { Box, Chip, Stack, Typography } from "@mui/material";
import CheckOutlinedIcon from '@mui/icons-material/CheckOutlined';

import { Account } from '@repo/api';

import DialogWindow from '@widgets/core/DialogWindow';
import TextInput    from '@widgets/core/TextInput';
import { GOOGLE_FONTS, FONT_CATEGORIES, FontCategory, type FontEntry, ensureFamiliesLoaded, toBrandFont, ensureStylesheet } from '@widgets/core/GoogleFonts';

//
// GoogleFontPickerDialog — browse + search the Google Font catalog and choose the theme's brand fonts. Edits a
// LOCAL DRAFT: toggles change the draft only; "Set" commits it (via onChange), "Cancel" discards it. SELECTED
// fonts sit at the TOP (previewed, removable) for quick reference; a search box + category filter drive the
// browsable catalog beneath. Each row previews in its own font (the catalog stylesheet is injected on open).
//
export function GoogleFontPickerDialog( props : GoogleFontPickerDialog.Props ) : JSX.Element
{
    const [search,setSearch]     = React.useState< string >( "" );
    const [category,setCategory] = React.useState< FontCategory | "all" >( "all" );
    const [draft,setDraft]       = React.useState< Array<Account.BrandFont> >( props.value );   // local until "Set"

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( loadPreviews, [] );

    // inject the catalog's stylesheet once (plus any already-chosen fonts not in the catalog) so rows preview in-font
    function loadPreviews() : void
    {
        ensureFamiliesLoaded( GOOGLE_FONTS.map( ( entry : FontEntry ) : string => entry.family ) );
        props.value.forEach( ( font : Account.BrandFont ) : void => ensureStylesheet( font.href ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    const selectedNames : Set<string> = new Set( draft.map( ( font : Account.BrandFont ) : string => font.name ) );
    const term : string = search.trim().toLowerCase();

    // the catalog filtered by category + search
    const matches : Array<FontEntry> = GOOGLE_FONTS.filter( ( entry : FontEntry ) : boolean =>
        ( category === "all" || entry.category === category ) && ( term === "" || entry.family.toLowerCase().includes( term ) ) );

    // add / remove a family from the DRAFT (not committed until "Set")
    function toggle( family : string ) : void
    {
        if( selectedNames.has( family ) ) setDraft( draft.filter( ( font : Account.BrandFont ) : boolean => font.name !== family ) );
        else setDraft( [ ...draft, toBrandFont( family ) ] );
    }

    // "Set" — commit the draft to the theme, then close
    async function onSet() : Promise<boolean>
    {
        props.onChange( draft );
        return true;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="google-font-picker"
                          title={"Brand fonts"}
                          yesLabel={"Set"}
                          cancelLabel={"Cancel"}
                          minWidth="sm"
                          onYes={ onSet }
                          onClose={ props.onClose }>
                <Stack spacing={ 1.5 } sx={{ p: 2 }}>

                    {/* SELECTED — at the top for quick reference + removal (draft) */}
                    <Box>
                        <Typography variant="caption" sx={{ color: "text.secondary" }}>{ `Selected (${ draft.length })` }</Typography>
                        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: 0.5 }}>
                            { draft.length === 0 ? <Typography variant="body2" sx={{ color: "text.secondary" }}>{"None yet — pick from below."}</Typography> : null }
                            { draft.map( ( font : Account.BrandFont ) : JSX.Element => (
                                <Chip key={ font.name } label={ font.name } onDelete={ () : void => toggle( font.name ) } variant="outlined" sx={{ fontFamily: `'${ font.name }', sans-serif` }} /> ) ) }
                        </Box>
                    </Box>

                    {/* SEARCH + CATEGORY filter */}
                    <TextInput id="font-search" label={"Search fonts"} value={ search } fullWidth onChange={ setSearch } />
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                        <Chip size="small" label={"All"} color={ category === "all" ? "primary" : "default" } variant={ category === "all" ? "filled" : "outlined" } onClick={ () : void => setCategory( "all" ) } />
                        { FONT_CATEGORIES.map( ( cat : FontCategory ) : JSX.Element => (
                            <Chip key={ cat } size="small" label={ cat } color={ category === cat ? "primary" : "default" } variant={ category === cat ? "filled" : "outlined" } onClick={ () : void => setCategory( cat ) } /> ) ) }
                    </Box>

                    {/* BROWSABLE catalog */}
                    <Box sx={{ maxHeight: 340, overflow: "auto", border: 1, borderColor: "divider", borderRadius: 1 }}>
                        { matches.map( ( entry : FontEntry ) : JSX.Element => (
                            <Stack key={ entry.family } direction="row"
                                   onClick={ () : void => toggle( entry.family ) }
                                   sx={{ alignItems: "center", px: 1.5, py: 1, cursor: "pointer", borderBottom: 1, borderColor: "divider",
                                         bgcolor: selectedNames.has( entry.family ) ? "action.selected" : "transparent",
                                         "&:hover": { bgcolor: selectedNames.has( entry.family ) ? "action.selected" : "action.hover" } }}>
                                <Typography sx={{ flexGrow: 1, fontFamily: `'${ entry.family }', sans-serif`, fontSize: 18 }}>{ entry.family }</Typography>
                                <Typography variant="caption" sx={{ color: "text.secondary", mr: 1 }}>{ entry.category }</Typography>
                                { selectedNames.has( entry.family ) ? <CheckOutlinedIcon fontSize="small" color="primary" /> : null }
                            </Stack> ) ) }
                        { matches.length === 0 ? <Typography variant="body2" sx={{ p: 2, color: "text.secondary" }}>{"No fonts match."}</Typography> : null }
                    </Box>
                </Stack>
            </DialogWindow>;
}

export namespace GoogleFontPickerDialog
{
    export interface Props
    {
        value    : Array<Account.BrandFont>;                        // the theme's current brand fonts (draft seed)
        onChange : ( fonts : Array<Account.BrandFont> ) => void;    // committed on "Set"
        onClose  : () => void;                                      // "Cancel" — discard draft
    }
}

export default GoogleFontPickerDialog;
// eof
