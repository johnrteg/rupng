//
import React from 'react';
import { JSX } from "react";

import { Box, Button, Stack, Typography } from "@mui/material";
import AddOutlinedIcon         from '@mui/icons-material/AddOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';

import { Access } from '@repo/system';

import DialogWindow from '@widgets/core/DialogWindow';
import ButtonIcon   from '@widgets/core/ButtonIcon';
import TextInput    from '@widgets/core/TextInput';
import SelectInput  from '@widgets/core/SelectInput';

//
// InvitePeopleDialog — invite MANY people at once. One or more ROWS, each a role + a free-text list of emails
// (comma / space / newline separated), so a caller can invite several users at a role and add more rows for
// other roles in a single action. The parent owns open/close + does the actual per-invite POSTs via onInvite;
// this dialog only collects + flattens the rows into { email, role } pairs.
//
export function InvitePeopleDialog( props : InvitePeopleDialog.Props ) : JSX.Element
{
    const [rows,setRows] = React.useState< Array<InvitePeopleDialog.Row> >( [ { role: Access.AccountRole.USER, emails: "" } ] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // split a row's free-text emails into individual, de-duped addresses (comma / whitespace separated)
    function parseEmails( text : string ) : Array<string>
    {
        const parts : Array<string> = text.split( /[\s,;]+/ )
            .map( ( part : string ) : string => part.trim() )
            .filter( ( part : string ) : boolean => part !== "" && part.includes( "@" ) );
        return Array.from( new Set( parts ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // every valid { email, role } pair across all rows (de-duped by email within a row)
    function pairs() : Array<InvitePeopleDialog.Invite>
    {
        const out : Array<InvitePeopleDialog.Invite> = [];
        for( const row of rows )
            for( const email of parseEmails( row.emails ) )
                out.push( { email, role: row.role as Access.Role } );
        return out;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // add another (role, emails) row
    function addRow() : void
    {
        setRows( ( prev : Array<InvitePeopleDialog.Row> ) => [ ...prev, { role: Access.AccountRole.USER, emails: "" } ] );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // remove the row at an index (kept to at least one row)
    function removeRow( index : number ) : void
    {
        setRows( ( prev : Array<InvitePeopleDialog.Row> ) => prev.length > 1 ? prev.filter( ( _row : InvitePeopleDialog.Row, at : number ) : boolean => at !== index ) : prev );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // update the role on the row at an index
    function setRole( index : number, role : string ) : void
    {
        setRows( ( prev : Array<InvitePeopleDialog.Row> ) => prev.map( ( row : InvitePeopleDialog.Row, at : number ) : InvitePeopleDialog.Row => at === index ? { ...row, role } : row ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // update the emails text on the row at an index
    function setEmails( index : number, emails : string ) : void
    {
        setRows( ( prev : Array<InvitePeopleDialog.Row> ) => prev.map( ( row : InvitePeopleDialog.Row, at : number ) : InvitePeopleDialog.Row => at === index ? { ...row, emails } : row ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // hand the flattened invites to the parent (which does the POSTs)
    function onYes() : Promise<boolean>
    {
        const invites : Array<InvitePeopleDialog.Invite> = pairs();
        if( invites.length === 0 ) return Promise.resolve( false );
        return props.onInvite( invites );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // one editable row — role picker + multi-email field + remove button
    function inviteRow( row : InvitePeopleDialog.Row, index : number ) : JSX.Element
    {
        return  <Stack key={ index } direction="row" spacing={ 1 } sx={{ alignItems: "flex-start" }}>
                    <SelectInput id={ `invite-role-${ index }` } label={"Role"} value={ row.role } choices={ props.roleChoices }
                                 onChange={ ( role : string ) : void => setRole( index, role ) } sx={{ width: 170 }} />
                    <TextInput id={ `invite-emails-${ index }` } label={"Emails"} value={ row.emails }
                               onChange={ ( emails : string ) : void => setEmails( index, emails ) }
                               fullWidth multiline maxRows={ 4 } placeHolder={"name@example.com, another@example.com"} />
                    <Box sx={{ mt: 1 }}>
                        <ButtonIcon id={ `invite-rm-${ index }` } label={"Remove row"} size="small" disabled={ rows.length <= 1 }
                                    icon={ <DeleteOutlineOutlinedIcon fontSize="small" /> } onClick={ () => removeRow( index ) } />
                    </Box>
                </Stack>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    const total : number = pairs().length;

    return  <DialogWindow id="invite-people"
                          title={"Invite people"}
                          yesLabel={ total > 0 ? `Send ${ total } invite${ total === 1 ? "" : "s" }` : "Send invites" }
                          cancelLabel={"Cancel"}
                          minWidth="md"
                          ready={ total > 0 }
                          onYes={ onYes }
                          onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2 }}>
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>
                        {"Add a role and the emails to invite at that role — separate multiple emails with commas or new lines. Add more rows to invite different roles."}
                    </Typography>
                    <Stack spacing={ 2 }>
                        { rows.map( ( row : InvitePeopleDialog.Row, index : number ) => inviteRow( row, index ) ) }
                    </Stack>
                    <Box>
                        <Button size="small" startIcon={ <AddOutlinedIcon /> } onClick={ addRow }>{"Add role row"}</Button>
                    </Box>
                </Stack>
            </DialogWindow>;
}

export namespace InvitePeopleDialog
{
    /** One editable row: a role + its free-text list of emails. */
    export interface Row { role : string; emails : string; }

    /** A flattened, ready-to-send invite. */
    export interface Invite { email : string; role : Access.Role; }

    export interface Props
    {
        roleChoices : Array<SelectInput.Choice>;
        onInvite    : ( invites : Array<Invite> ) => Promise<boolean>;
        onClose     : () => void;
    }
}

export default InvitePeopleDialog;
