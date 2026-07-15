import React from 'react';
import { JSX } from "react";

import { Box, Chip, Stack, Typography } from "@mui/material";
import TextFieldsOutlinedIcon from '@mui/icons-material/TextFieldsOutlined';

import { Account } from '@repo/api';

import ButtonIcon from '@widgets/core/ButtonIcon';
import { ensureStylesheet } from '@widgets/core/GoogleFonts';
import GoogleFontPickerDialog from '@widgets/app/GoogleFontPickerDialog';

//
// BrandFontEditor — a CONTROLLED editor for a theme's brand fonts (public web-font references). Shows the chosen
// fonts as chips previewed in their own family (each font's stylesheet is loaded on demand), with remove, and a
// "Browse Google Fonts" button that opens the catalog picker to add more. The host owns the array + persistence.
// Reused by Account → Theme and the campaign editor's Theme step.
//
export function BrandFontEditor( props : BrandFontEditor.Props ) : JSX.Element
{
    const [pickerOpen,setPickerOpen] = React.useState< boolean >( false );
    const fonts : Array<Account.BrandFont> = props.value;
    const readOnly : boolean = props.readOnly === true;

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( loadPreviews );

    // ensure every chosen font's stylesheet is injected so the chips preview in-family
    function loadPreviews() : void
    {
        fonts.forEach( ( font : Account.BrandFont ) : void => ensureStylesheet( font.href ) );
    }

    // remove the font at `index`
    function remove( index : number ) : void
    {
        props.onChange( fonts.filter( ( _font : Account.BrandFont, at : number ) : boolean => at !== index ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return <Stack spacing={ 1.5 }>
        {/* header: label + the browse trigger */}
        <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}>
            { props.label !== undefined ? <Typography variant="subtitle2">{ props.label }</Typography> : null }
            { !readOnly ? <ButtonIcon id="brand-font-add" label={"Browse Google Fonts"} size="small" icon={ <TextFieldsOutlinedIcon fontSize="small" /> } onClick={ () : void => setPickerOpen( true ) } /> : null }
        </Stack>

        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center" }}>
            { fonts.length === 0 ? <Typography variant="body2" sx={{ color: "text.secondary" }}>{"No brand fonts yet."}</Typography> : null }
            { fonts.map( ( font : Account.BrandFont, at : number ) : JSX.Element => (
                <Chip key={ font.name }
                      label={ font.name }
                      onDelete={ readOnly ? undefined : () : void => remove( at ) }
                      variant="outlined"
                      sx={{ fontFamily: `'${ font.name }', sans-serif`, fontSize: 15 }} /> ) ) }
        </Box>

        { pickerOpen ?
            <GoogleFontPickerDialog value={ fonts } onChange={ props.onChange } onClose={ () : void => setPickerOpen( false ) } /> : null }
    </Stack>;
}

export namespace BrandFontEditor
{
    export interface Props
    {
        value     : Array<Account.BrandFont>;
        label?    : string;                       // section title shown before the browse button
        readOnly? : boolean;
        onChange  : ( fonts : Array<Account.BrandFont> ) => void;
    }
}

export default BrandFontEditor;
// eof
