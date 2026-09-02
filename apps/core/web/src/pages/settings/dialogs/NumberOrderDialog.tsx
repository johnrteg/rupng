//
import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Stack, Button, CircularProgress, Typography } from "@mui/material";

import { Registration, Texting } from '@repo/api';

import DialogWindow from '@widgets/core/DialogWindow';
import SelectInput   from '@widgets/core/SelectInput';
import TextInput     from '@widgets/core/TextInput';
import TableInput    from '@widgets/core/TableInput';

//
// NumberOrderDialog — search a carrier's available-number inventory, pick ONE, then order it (registration-4.x).
// A LONG_CODE order requires picking an already-APPROVED campaign to bind to; TOLL_FREE needs none (its own
// verification is the separate `TollFreeVerificationDialog`, submitted after the number is owned).
//
export function NumberOrderDialog( props : NumberOrderDialog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const [carrier,setCarrier]   = React.useState< Registration.CarrierProvider >( Registration.CarrierProvider.FAKE );
    const [areaCode,setAreaCode] = React.useState< string >( "" );
    const [campaignId,setCampaignId] = React.useState< string >( props.campaigns[ 0 ]?.campaignId ?? "" );
    const [searching,setSearching]   = React.useState< boolean >( false );
    const [results,setResults]       = React.useState< Array<NumberOrderDialog.AvailableNumber> >( [] );
    const [selected,setSelected]     = React.useState< string | undefined >( undefined );

    const isLongCode : boolean = props.numberType === Texting.NumberType.LONG_CODE;
    const ready : boolean = selected !== undefined && ( !isLongCode || campaignId !== "" );

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function onSearch() : Promise<void>
    {
        setSearching( true );
        setSelected( undefined );
        const found : Array<NumberOrderDialog.AvailableNumber> = await props.onSearch( { carrier, areaCode: areaCode.trim() || undefined } );
        setResults( found );
        setSearching( false );
    }

    function onYes() : Promise<boolean>
    {
        if( selected === undefined ) return Promise.resolve( false );
        return props.onOrder( { number: selected, carrier, campaignId: isLongCode ? campaignId : undefined } );
    }

    const columns : Array<TableInput.Column> =
    [
        { field: "number", label: "Number", type: TableInput.ColumnType.STRING },
        { field: "price",  label: "Monthly price", type: TableInput.ColumnType.STRING },
    ];
    const rows : Array<TableInput.Row> = results.map( ( row : NumberOrderDialog.AvailableNumber ) : TableInput.Row => ( {
        id: row.number, number: row.number,
        price: row.monthlyPriceCents !== undefined ? ( appmodel.ui.locale.currency( row.monthlyPriceCents / 100, 2 ) ?? "" ) : "—",
    } ) );

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="registration-number-order" title={ isLongCode ? "Order a long-code number" : "Order a toll-free number" }
                          yesLabel={"Order number"} cancelLabel={"Cancel"} minWidth="md" ready={ ready } onYes={ onYes } onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ pt: 1, minHeight: 320 }}>
                    { isLongCode &&
                        <SelectInput id="number-order-campaign" label={"Approved campaign"} value={ campaignId }
                                    choices={ props.campaigns.map( ( campaign : Registration.Campaign ) : SelectInput.Choice => ( { value: campaign.campaignId ?? "", label: campaign.description.slice( 0, 60 ) } ) ) }
                                    onChange={ setCampaignId } /> }
                    { isLongCode && props.campaigns.length === 0 &&
                        <Typography variant="body2" color="error">No approved campaign yet — create and get one approved first.</Typography> }

                    <Stack direction="row" spacing={ 2 } sx={{ alignItems: "flex-end" }}>
                        <SelectInput id="number-order-carrier" label={"Carrier"} value={ carrier }
                                    choices={ SelectInput.enumToChoices( Registration.CarrierProvider ) } onChange={ ( value : string ) : void => setCarrier( value as Registration.CarrierProvider ) } />
                        <TextInput id="number-order-area-code" label={"Area code (optional)"} value={ areaCode } onChange={ setAreaCode } />
                        <Button variant="outlined" onClick={ () => void onSearch() } disabled={ searching }>
                            { searching ? <CircularProgress size={ 20 } /> : "Search" }
                        </Button>
                    </Stack>

                    <TableInput id="number-order-results" columns={ columns } data={ rows }
                               selectable={ TableInput.Selectable.SINGLE } selected={ selected ? [ selected ] : [] }
                               onSelected={ ( ids : Array<string> ) : void => setSelected( ids[ 0 ] ) } />
                </Stack>
            </DialogWindow>;
}

export namespace NumberOrderDialog
{
    export interface AvailableNumber { number : string; monthlyPriceCents? : number; }

    export interface Props
    {
        numberType : Texting.NumberType.LONG_CODE | Texting.NumberType.TOLL_FREE;
        campaigns  : Array<Registration.Campaign>;   // approved campaigns — only offered for LONG_CODE
        onSearch   : ( criteria : { carrier : Registration.CarrierProvider; areaCode? : string } ) => Promise<Array<AvailableNumber>>;
        onOrder    : ( input : { number : string; carrier : Registration.CarrierProvider; campaignId? : string } ) => Promise<boolean>;
        onClose    : () => void;
    }
}

export default NumberOrderDialog;
// eof
