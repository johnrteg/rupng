import React from 'react';
import { JSX } from "react";

import { Stack, Typography } from "@mui/material";

import DialogWindow from '@widgets/core/DialogWindow';
import TextInput    from '@widgets/core/TextInput';
import SelectInput  from '@widgets/core/SelectInput';

import { StudioProject } from '@repo/api';
import { StudioImageEditor } from '@pages/media/studio/image/StudioImageEditor';

//
// StudioPageSetupDialog — define an image project's PAGE: its size (a preset or custom Width × Height in
// inches or pixels) and print density (DPI). Inches × DPI gives the output pixel size; pixel sizes are
// absolute (DPI is then informational). The parent owns open/close and applies the resulting PageSpec (which
// sizes the page frame on the canvas + drives export). The dialog owns its own form state, seeded from the
// current page.
//
export function StudioPageSetupDialog( props : StudioPageSetupDialog.Props ) : JSX.Element
{
    const [preset,setPreset] = React.useState< string >( "custom" );
    const [unit,setUnit]     = React.useState< StudioProject.PageUnit >( props.spec.unit );
    const [width,setWidth]   = React.useState< string >( String( props.spec.width ) );
    const [height,setHeight] = React.useState< string >( String( props.spec.height ) );
    const [dpi,setDpi]       = React.useState< string >( String( props.spec.dpi ) );

    // the parsed, validated numbers (NaN / non-positive → invalid)
    const widthNum : number = Number.parseFloat( width );
    const heightNum : number = Number.parseFloat( height );
    const dpiNum : number = Number.parseInt( dpi, 10 );
    const valid : boolean = widthNum > 0 && heightNum > 0 && dpiNum > 0;

    ////////////////////////////////////////////////////////////////////////////////////////////
    // choose a preset — fill unit + width + height from it (DPI is left to the user's selection)
    function onPreset( value : string ) : void
    {
        setPreset( value );
        const chosen : StudioImageEditor.PagePreset | undefined = StudioImageEditor.PAGE_PRESETS.find( ( entry : StudioImageEditor.PagePreset ) : boolean => entry.key === value );
        if( chosen === undefined || value === "custom" ) return;
        setUnit( chosen.unit );
        setWidth( String( chosen.width ) );
        setHeight( String( chosen.height ) );
        if( chosen.dpi !== undefined ) setDpi( String( chosen.dpi ) );
    }

    // any manual size/unit edit drops back to "Custom" (it no longer matches a named preset)
    function onWidth( value : string ) : void  { setWidth( value ); setPreset( "custom" ); }
    function onHeight( value : string ) : void { setHeight( value ); setPreset( "custom" ); }
    function onUnit( value : string ) : void   { setUnit( value as StudioProject.PageUnit ); setPreset( "custom" ); }

    // apply — hand the parent the resolved spec (keeping the existing frame id so the same page frame resizes)
    async function onYes() : Promise<boolean>
    {
        if( !valid ) return false;
        const spec : StudioProject.PageSpec = { unit, width: widthNum, height: heightNum, dpi: dpiNum };
        props.onApply( spec );
        return true;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // choice lists
    const presetChoices : Array<SelectInput.Choice> = StudioImageEditor.PAGE_PRESETS.map( ( entry : StudioImageEditor.PagePreset ) : SelectInput.Choice => ( { value: entry.key, label: entry.label } ) );
    const unitChoices : Array<SelectInput.Choice> = [ { value: StudioProject.PageUnit.INCHES, label: "Inches" }, { value: StudioProject.PageUnit.PIXELS, label: "Pixels" } ];
    const dpiChoices : Array<SelectInput.Choice> = StudioImageEditor.DPI_CHOICES.map( ( value : number ) : SelectInput.Choice => ( { value: String( value ), label: `${ value } dpi` } ) );

    // the resolved output pixel size, for a live preview under the form
    const pixels : { width : number; height : number } = valid
        ? StudioImageEditor.pagePixels( { unit, width: widthNum, height: heightNum, dpi: dpiNum } )
        : { width: 0, height: 0 };

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="studio-page-setup"
                          title={"Page Setup"}
                          yesLabel={"Apply"}
                          cancelLabel={"Cancel"}
                          minWidth="xs"
                          ready={ valid }
                          onYes={ onYes }
                          onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2 }}>
                    <SelectInput id="page-preset" label={"Preset"} value={ preset } choices={ presetChoices } onChange={ onPreset } sx={{ width: "100%" }} />
                    <SelectInput id="page-unit"   label={"Units"}  value={ unit }   choices={ unitChoices }   onChange={ onUnit }   sx={{ width: "100%" }} />
                    <Stack direction="row" spacing={ 1 }>
                        <TextInput id="page-width"  label={"Width"}  value={ width }  onChange={ onWidth }  fullWidth />
                        <TextInput id="page-height" label={"Height"} value={ height } onChange={ onHeight } fullWidth />
                    </Stack>
                    <SelectInput id="page-dpi" label={"Density"} value={ dpi } choices={ dpiChoices } onChange={ setDpi } sx={{ width: "100%" }}
                                 disabled={ unit === StudioProject.PageUnit.PIXELS } helperText={ unit === StudioProject.PageUnit.PIXELS ? "Pixel sizes are absolute; density is informational." : undefined } />
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        { valid ? `Output: ${ pixels.width } × ${ pixels.height } px` : "Enter a positive width, height, and density." }
                    </Typography>
                </Stack>
            </DialogWindow>;
}

export namespace StudioPageSetupDialog
{
    export interface Props
    {
        spec    : StudioProject.PageSpec;                       // the current page (seeds the form)
        onApply : ( spec : StudioProject.PageSpec ) => void;    // apply the new page definition
        onClose : () => void;
    }
}

export default StudioPageSetupDialog;
// eof
