import React from 'react';
import { JSX } from "react";

import { Box, Stack, Typography } from "@mui/material";
import InterestsOutlinedIcon from '@mui/icons-material/InterestsOutlined';
import CloseOutlinedIcon     from '@mui/icons-material/CloseOutlined';

import { Account } from '@repo/api';

import ButtonIcon   from '@widgets/core/ButtonIcon';
import { svgDataUrl } from '@widgets/core/SvgCatalog';
import SvgPickerDialog from '@widgets/app/SvgPickerDialog';

//
// BrandSvgEditor — a CONTROLLED editor for a theme's brand graphics (SVGs). Shows the chosen graphics as preview
// thumbnails with remove, and an "Add graphics" button that opens the catalog / BYO-paste picker. The host owns
// the array + persistence. Reused by Account → Branding and the campaign editor's Theme step.
//
export function BrandSvgEditor( props : BrandSvgEditor.Props ) : JSX.Element
{
    const [pickerOpen,setPickerOpen] = React.useState< boolean >( false );
    const svgs : Array<Account.BrandSvg> = props.value;
    const readOnly : boolean = props.readOnly === true;

    // remove the graphic at `index`
    function remove( index : number ) : void
    {
        props.onChange( svgs.filter( ( _item : Account.BrandSvg, at : number ) : boolean => at !== index ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return <Stack spacing={ 1.5 }>
        {/* header: label + the add-graphics trigger */}
        <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}>
            { props.label !== undefined ? <Typography variant="subtitle2">{ props.label }</Typography> : null }
            { !readOnly ? <ButtonIcon id="brand-svg-add" label={"Add graphics"} size="small" icon={ <InterestsOutlinedIcon fontSize="small" /> } onClick={ () : void => setPickerOpen( true ) } /> : null }
        </Stack>

        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5, alignItems: "center" }}>
            { svgs.length === 0 ? <Typography variant="body2" sx={{ color: "text.secondary" }}>{"No brand graphics yet."}</Typography> : null }
            { svgs.map( ( item : Account.BrandSvg, at : number ) : JSX.Element => (
                <Box key={ item.name } sx={{ position: "relative", width: 52, height: 52, border: 1, borderColor: "divider", borderRadius: 1, display: "flex", alignItems: "center", justifyContent: "center", p: 0.5 }}>
                    <Box component="img" src={ svgDataUrl( item.svg ) } alt={ item.name } title={ item.name } sx={{ width: 32, height: 32 }} />
                    { !readOnly ? <ButtonIcon id={ `svg-del-${ at }` } label={"Remove"} size="small" icon={ <CloseOutlinedIcon sx={{ fontSize: 12 }} /> } onClick={ () : void => remove( at ) } sx={{ position: "absolute", top: -10, right: -10 }} /> : null }
                </Box> ) ) }
        </Box>

        { pickerOpen ?
            <SvgPickerDialog value={ svgs } onChange={ props.onChange } onClose={ () : void => setPickerOpen( false ) } /> : null }
    </Stack>;
}

export namespace BrandSvgEditor
{
    export interface Props
    {
        value     : Array<Account.BrandSvg>;
        label?    : string;                      // section title shown before the add button
        readOnly? : boolean;
        onChange  : ( svgs : Array<Account.BrandSvg> ) => void;
    }
}

export default BrandSvgEditor;
// eof
