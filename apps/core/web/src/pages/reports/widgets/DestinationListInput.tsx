//
import React from 'react';
import { JSX } from "react";

import { Stack, Typography } from "@mui/material";
import AddCircleOutlineOutlinedIcon from '@mui/icons-material/AddCircleOutlineOutlined';
import DeleteOutlineOutlinedIcon    from '@mui/icons-material/DeleteOutlineOutlined';

import { Report } from '@repo/api';

import ButtonIcon from '@widgets/core/ButtonIcon';

import DestinationInput from './DestinationInput';

// a freshly-added row's default — DOWNLOAD needs no config, matching the server's own default when omitted.
const DEFAULT_DESTINATION : Report.Destination = { kind: Report.DestinationKind.DOWNLOAD, config: {} };

//
// DestinationListInput — edits an ARRAY of `Report.Destination` (report-2.1/4.1 now fan out to N
// destinations, not one). Renders one `DestinationInput` row per entry plus an "Add destination" action, and
// a per-row remove action; empty state renders no rows (the server defaults an empty/omitted list to a single
// DOWNLOAD destination, so this stays valid).
//
export function DestinationListInput( props : DestinationListInput.Props ) : JSX.Element
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    // append a new default (DOWNLOAD) row
    function onAdd() : void
    {
        props.onChange( [ ...props.value, DEFAULT_DESTINATION ] );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // one row's DestinationInput changed — replace it in place
    function onRowChange( index : number, destination : Report.Destination ) : void
    {
        const next : Array<Report.Destination> = props.value.map( ( entry : Report.Destination, entryIndex : number ) : Report.Destination => entryIndex === index ? destination : entry );
        props.onChange( next );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // remove one row by index
    function onRowRemove( index : number ) : void
    {
        props.onChange( props.value.filter( ( _entry : Report.Destination, entryIndex : number ) : boolean => entryIndex !== index ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <Stack spacing={ 1 }>
                <Typography variant="subtitle2">{"Destinations"}</Typography>
                { props.value.length === 0 &&
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>{"No destinations added — defaults to a download link."}</Typography> }
                { props.value.map( ( destination : Report.Destination, index : number ) : JSX.Element => (
                    <Stack key={ index } direction="row" spacing={ 1 } sx={{ alignItems: "flex-start" }}>
                        <DestinationInput value={ destination } onChange={ ( value : Report.Destination ) : void => onRowChange( index, value ) } />
                        <ButtonIcon id={ `destination-remove-${ index }` } label={"Remove destination"}
                                    icon={ <DeleteOutlineOutlinedIcon fontSize="small" /> }
                                    onClick={ () => onRowRemove( index ) } />
                    </Stack>
                ) ) }
                <ButtonIcon id="destination-add" label={"Add destination"}
                            icon={ <AddCircleOutlineOutlinedIcon fontSize="small" /> }
                            onClick={ onAdd } />
            </Stack>;
}

export namespace DestinationListInput
{
    export interface Props
    {
        value    : Array<Report.Destination>;
        onChange : ( value : Array<Report.Destination> ) => void;
    }
}

export default DestinationListInput;
// eof
