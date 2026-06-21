//
import React from 'react';
import { JSX } from "react";
import { Theme, useTheme } from '@mui/material/styles';

//
import { Typography, TypographyVariant } from '@mui/material';
import { ValueUtils } from '@repo/common';


export function TextLabel( props : TextLabel.Props ) : JSX.Element
{
    const theme : Theme = useTheme();

    return <Typography  variant={ props.variant as TypographyVariant ?? "inherit" }
                        align={ props.align ?? "inherit"}
                        noWrap={ props.noWrap !== undefined ? props.noWrap : false }
                        component="span"
                        sx={{   fontWeight      : ValueUtils.notNull( props.bold ) && props.bold ? 'bold' : 'normal',
                                fontStyle       : ValueUtils.notNull( props.italic ) && props.italic ? 'italic' : 'normal',
                                textDecoration  : props.strikethru ? 'line-through' : undefined,
                                width           : ValueUtils.notNull( props.width ) ? props.width : undefined,
                                pt              : props.padding?.top ?? props.padding?.top,
                                pb              : props.padding?.bottom ?? props.padding?.bottom,
                                pr              : props.padding?.right ?? props.padding?.right,
                                pl              : props.padding?.left ?? props.padding?.left,
                                color           : props.sx !== undefined && props.sx.color !== undefined ? props.sx.color : theme.palette.text.primary 
                            } }
                        color={ props.color !== undefined ? props.color : theme.palette.text.primary }
            >
            { props.value }
            </Typography>;

}


/**
 * TextLabel component wraps Typography with simplier argument to manage display.
 *
 * @param props.variant - font style utilizing the same variant property of Typography
 * @param props.value - String to dsiplay
 * @param props.align - left | center | right | justify | inherit of the text relative to the parent container.
 * @param props.color - Theme colors for the text.
 * @param props.bold -  Make the value bold.
 * @param props.italic - Make the value italics.
 * @param props.strikethru - Strikethru the value.
 * @param props.noWrap - Do not allow the value to wrap around.
 * @param props.sx - color : Override props.color to any hex value color.
 * @param props.width - Width of the containing text, either numeric and string (e.g. 100%).
 * @param props.padding - left, right, top, and bottom padding
 */
export namespace TextLabel
{
    export type Color = "primary" | "secondary" | "success" | "error" | "info" | "warning" | "inherit" | "text.disabled";
    export type Align = "left" | "center" | "right" | "justify" | "inherit";
    export type Variant = TypographyVariant;
    //
    //
    //
    export interface Props
    {
        variant?    : TextLabel.Variant;
        value       : string;
        align?      : TextLabel.Align;
        color?      : TextLabel.Color | string;
        bold?       : boolean;
        italic?     : boolean;
        strikethru? : boolean;
        noWrap?     : boolean;
        sx?         : { color : string };
        width?      : string | number;
        padding?    : { left?: number, top?: number, right?: number, bottom?: number };
    }

}

export default TextLabel;

// eof