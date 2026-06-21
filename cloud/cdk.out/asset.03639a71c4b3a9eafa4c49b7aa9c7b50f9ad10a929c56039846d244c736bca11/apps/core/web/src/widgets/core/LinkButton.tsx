//
import React from 'react';
import { JSX } from "react";
import { Button } from '@mui/material';

//
export function LinkButton(props: LinkButton.Props): JSX.Element {
    const { label, onClick, color = 'primary', sx } = props;

    return (
        <Button
            variant="text"
            color={color as any}
            fullWidth
            sx={{
                textTransform: 'none',
                textDecoration: 'underline',
                minWidth: 0,
                p: 0,
                justifyContent: 'flex-start',
                alignItems: 'flex-start',
                ...sx,
            }}
            onClick={onClick}
        >
            {label}
        </Button>
    );
}

export namespace LinkButton {
    export interface Props {
        label: string;
        onClick: () => void;
        color?: string;
        sx?: object;
    }
}

export default LinkButton;

// eof