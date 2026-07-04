import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Button, Card, CardContent, CardHeader, Divider, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from "@mui/material";

import { Billing, GetPayments, GetInvoices } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import LocaleService from '@model/service/LocaleService';
import DateInput     from '@widgets/core/DateInput';

//
// Billing history — payments OR invoices for the acting account, with an optional ISO date range that
// re-queries on Apply. SKELETON: the list is empty until Stripe records exist; the filter proves the wiring
// end-to-end. One component, driven by `kind`, so the History tab can mount two of them.
//
export function BillingHistory( props : BillingHistory.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [from,setFrom]         = React.useState< Date | null >( null );
    const [to,setTo]             = React.useState< Date | null >( null );
    const [payments,setPayments] = React.useState< Array<Billing.Payment> >( [] );
    const [invoices,setInvoices] = React.useState< Array<Billing.Invoice> >( [] );
    const [busy,setBusy]         = React.useState< boolean >( false );

    const isPayments : boolean = props.kind === "payments";

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( () => { void query(); }, [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // (re)load the list for the current date range
    async function query() : Promise<void>
    {
        setBusy( true );
        const range : { from? : string; to? : string } = { from: from ? from.toISOString() : undefined, to: to ? to.toISOString() : undefined };
        if( isPayments )
        {
            const reply : RestfulService.Reply<GetPayments.Response> = await appmodel.server.fetch( new GetPayments( range ) );
            if( reply.ok && reply.data ) setPayments( reply.data.payments );
        }
        else
        {
            const reply : RestfulService.Reply<GetInvoices.Response> = await appmodel.server.fetch( new GetInvoices( range ) );
            if( reply.ok && reply.data ) setInvoices( reply.data.invoices );
        }
        setBusy( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // format money (minor units → localized currency)
    function money( value? : Billing.Money ) : string
    {
        if( !value ) return "—";
        const formatter : Intl.NumberFormat = new Intl.NumberFormat( undefined, { style: "currency", currency: value.currency || "USD" } );
        return formatter.format( value.amountMinor / 100 );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // format an ISO timestamp via the app locale
    function displayDate( iso? : string ) : string
    {
        return appmodel.ui.locale.dateTime( iso ? new Date( iso ) : null, LocaleService.Format.LONG ) || "—";
    }

    const empty : boolean = isPayments ? payments.length === 0 : invoices.length === 0;

    return  <Card variant="outlined">
                <CardHeader title={ isPayments ? "Payment history" : "Invoices" } subheader={"Filter by date range (optional)."} />
                <Divider />
                <CardContent>
                    <Stack spacing={ 2 }>
                        <Stack direction={{ xs: "column", sm: "row" }} spacing={ 2 } sx={{ alignItems: { sm: "center" } }}>
                            <DateInput id={`${ props.kind }-from`} label={"From"} value={ from } clearable onChange={ ( value : Date | null ) => setFrom( value ) } />
                            <DateInput id={`${ props.kind }-to`} label={"To"} value={ to } clearable onChange={ ( value : Date | null ) => setTo( value ) } />
                            <Button variant="outlined" disabled={ busy } onClick={ () => void query() }>{"Apply"}</Button>
                        </Stack>

                        { empty
                            ? <Typography variant="body2" sx={{ color: "text.secondary" }}>{ isPayments ? "No payments in this range." : "No invoices in this range." }</Typography>
                            : <TableContainer>
                                <Table size="small">
                                    { isPayments
                                        ? <>
                                            <TableHead><TableRow><TableCell>{"Date"}</TableCell><TableCell>{"Description"}</TableCell><TableCell>{"Status"}</TableCell><TableCell align="right">{"Amount"}</TableCell></TableRow></TableHead>
                                            <TableBody>
                                                { payments.map( ( payment : Billing.Payment ) =>
                                                    <TableRow key={ payment.id }>
                                                        <TableCell>{ displayDate( payment.createdAt ) }</TableCell>
                                                        <TableCell>{ payment.description ?? "—" }</TableCell>
                                                        <TableCell>{ payment.status }</TableCell>
                                                        <TableCell align="right">{ money( payment.amount ) }</TableCell>
                                                    </TableRow> ) }
                                            </TableBody>
                                          </>
                                        : <>
                                            <TableHead><TableRow><TableCell>{"Date"}</TableCell><TableCell>{"Status"}</TableCell><TableCell align="right">{"Total"}</TableCell></TableRow></TableHead>
                                            <TableBody>
                                                { invoices.map( ( invoice : Billing.Invoice ) =>
                                                    <TableRow key={ invoice.id }>
                                                        <TableCell>{ displayDate( invoice.createdAt ) }</TableCell>
                                                        <TableCell>{ invoice.status }</TableCell>
                                                        <TableCell align="right">{ money( invoice.total ) }</TableCell>
                                                    </TableRow> ) }
                                            </TableBody>
                                          </>
                                    }
                                </Table>
                              </TableContainer>
                        }
                    </Stack>
                </CardContent>
            </Card>;
}

export namespace BillingHistory
{
    export interface Props
    {
        kind : "payments" | "invoices";
    }
}

export default BillingHistory;
// eof
