import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Checkbox, FormControlLabel, Stack, Typography } from "@mui/material";

import { Contact, GetContacts } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import DialogWindow from '@widgets/core/DialogWindow';
import TextInput    from '@widgets/core/TextInput';

//
// AddSegmentMembersDialog — add contacts to a segment by searching the account's contacts and checking the
// ones to add. Adding is idempotent server-side (no dups), so contacts already in the segment are simply
// re-confirmed. The parent does the POST via onAdd(contactIds).
//
export function AddSegmentMembersDialog( props : AddSegmentMembersDialog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [contacts,setContacts] = React.useState< Array<Contact.Entity> >( [] );
    const [search,setSearch]     = React.useState< string >( "" );
    const [picked,setPicked]     = React.useState< Set<string> >( new Set() );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( () => { void load(); }, [] );

    // load the account's contacts to pick from (first page)
    async function load() : Promise<void>
    {
        const reply : RestfulService.Reply<GetContacts.Response> = await appmodel.server.fetch( new GetContacts() );
        if( reply.ok && reply.data ) setContacts( reply.data.records );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // display name for a contact (falls back to a default email/phone)
    function displayName( contact : Contact.Entity ) : string
    {
        const name : string = [ contact.firstName, contact.lastName ].filter( ( part ) => !!part ).join( " " ).trim();
        return name !== "" ? name : ( contact.emails[ 0 ]?.value ?? contact.phones[ 0 ]?.value ?? "(no name)" );
    }

    // contacts matching the search box (by name / email / phone)
    function visible() : Array<Contact.Entity>
    {
        const needle : string = search.trim().toLowerCase();
        if( needle === "" ) return contacts;
        return contacts.filter( ( contact : Contact.Entity ) : boolean =>
            [ displayName( contact ), ...contact.emails.map( ( entry : Contact.EmailEntry ) : string => entry.value ), ...contact.phones.map( ( entry : Contact.PhoneEntry ) : string => entry.value ) ]
                .join( " " ).toLowerCase().includes( needle ) );
    }

    // toggle a contact in the picked set
    function toggle( id : string ) : void
    {
        setPicked( ( prev : Set<string> ) => { const next : Set<string> = new Set( prev ); if( next.has( id ) ) next.delete( id ); else next.add( id ); return next; } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onYes() : Promise<boolean>
    {
        if( picked.size === 0 ) return Promise.resolve( false );
        return props.onAdd( [ ...picked ] );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="segment-add-members"
                          title={"Add contacts to segment"}
                          yesLabel={ picked.size > 0 ? `Add ${ picked.size }` : "Add" }
                          cancelLabel={"Cancel"}
                          minWidth="sm"
                          ready={ picked.size > 0 }
                          onYes={ onYes }
                          onClose={ props.onClose }>
                <Stack spacing={ 1 } sx={{ p: 2 }}>
                    <TextInput id="add-members-search" label={"Search contacts"} value={ search } onChange={ setSearch } fullWidth placeHolder={"name, email, phone"} />
                    <Box sx={{ maxHeight: 340, overflow: "auto", border: "1px solid", borderColor: "divider", borderRadius: 1, p: 1 }}>
                        { visible().length === 0
                            ? <Typography variant="body2" sx={{ color: "text.secondary", p: 1 }}>{"No matching contacts."}</Typography>
                            : <Stack>
                                { visible().map( ( contact : Contact.Entity ) : JSX.Element => (
                                    <FormControlLabel key={ contact.id }
                                                      control={ <Checkbox size="small" checked={ picked.has( contact.id ) } onChange={ () : void => toggle( contact.id ) } /> }
                                                      label={ displayName( contact ) } />
                                ) ) }
                              </Stack> }
                    </Box>
                </Stack>
            </DialogWindow>;
}

export namespace AddSegmentMembersDialog
{
    export interface Props
    {
        onAdd   : ( contactIds : Array<string> ) => Promise<boolean>;
        onClose : () => void;
    }
}

export default AddSegmentMembersDialog;
