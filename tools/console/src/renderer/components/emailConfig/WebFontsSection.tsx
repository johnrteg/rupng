import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import { ConfigSection } from "../configEditor/ConfigSection";

/** A single web-font library entry — a display name and its stylesheet/link href. */
export interface WebFont { name : string; href : string; }

/** One web-font row — a display name plus its stylesheet href. */
function WebFontRow( props : WebFontRow.Props )
{
    return (
        <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, p: 1, display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            <TextField
                size="small" label="name" value={props.value.name} disabled={props.readOnly}
                onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => props.onChange( { ...props.value, name: event.target.value } )}
                sx={{ minWidth: 140 }}
            />
            <TextField
                size="small" label="href" value={props.value.href} disabled={props.readOnly}
                onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => props.onChange( { ...props.value, href: event.target.value } )}
                sx={{ flexGrow: 1, minWidth: 240 }}
            />
            <Tooltip title="Remove font">
                <span><IconButton size="small" disabled={props.readOnly} onClick={props.onRemove}><DeleteIcon fontSize="small" /></IconButton></span>
            </Tooltip>
        </Box>
    );
}

namespace WebFontRow
{
    export interface Props
    {
        value    : WebFont;
        onChange : ( value : WebFont ) => void;
        onRemove : () => void;
        readOnly : boolean;
    }
}

/** The platform (app-level) web-font library offered in the email template editor's font picker. */
export function WebFontsSection( props : WebFontsSection.Props )
{
    const fonts : Array<WebFont> = props.value ?? [];

    /** Patch one font by array index. */
    function onFontChange( index : number, value : WebFont ) : void
    {
        const next : Array<WebFont> = [ ...fonts ];
        next[ index ] = value;
        props.onChange( next );
    }

    /** Remove a font by array index. */
    function onRemove( index : number ) : void
    {
        props.onChange( fonts.filter( ( _font : WebFont, at : number ) : boolean => at !== index ) );
    }

    /** Add a blank font row for the operator to fill in. */
    function onAdd() : void
    {
        props.onChange( [ ...fonts, { name: "", href: "" } ] );
    }

    return (
        <ConfigSection title="Web fonts" hint="The platform's web-font library, offered in the email editor's font picker.">
            {fonts.map( ( font : WebFont, index : number ) => (
                <WebFontRow
                    key={index} value={font} readOnly={props.readOnly}
                    onChange={( value : WebFont ) : void => onFontChange( index, value )}
                    onRemove={() : void => onRemove( index )}
                />
            ) )}
            <Button size="small" startIcon={<AddIcon />} disabled={props.readOnly} onClick={onAdd}>Add font</Button>
        </ConfigSection>
    );
}

export namespace WebFontsSection
{
    export interface Props
    {
        value?   : Array<WebFont>;
        onChange : ( value : Array<WebFont> ) => void;
        readOnly : boolean;
    }
}

export default WebFontsSection;
