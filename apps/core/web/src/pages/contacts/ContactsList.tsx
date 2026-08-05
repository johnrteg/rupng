import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Button, Card, CardContent, CardHeader, CircularProgress, Divider, Stack, Typography } from "@mui/material";
import RefreshOutlinedIcon       from '@mui/icons-material/RefreshOutlined';
import AddOutlinedIcon           from '@mui/icons-material/AddOutlined';
import EditOutlinedIcon          from '@mui/icons-material/EditOutlined';
import ArchiveOutlinedIcon       from '@mui/icons-material/ArchiveOutlined';

import { Access } from '@repo/system';
import { Contact, GetContacts, PostContact, PatchContact, DeleteContact, Paging } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import AuthPage     from '@widgets/app/AuthPage';
import SearchInput  from '@widgets/core/SearchInput';
import ButtonIcon   from '@widgets/core/ButtonIcon';
import ChipStatus   from '@widgets/core/ChipStatus';
import TableInput   from '@widgets/core/TableInput';
import Colors       from '@utils/Colors';
import SnackAlert   from '@widgets/core/SnackAlert';
import AlertPrompt  from '@widgets/core/AlertPrompt';
import AccountChange from '@widgets/app/AccountChange';
import ContactEditDialog from '@pages/contacts/dialogs/ContactEditDialog';
import HelpButton from "../../widgets/core/HelpButton";

// TableInput row-action ids
enum ContactAction { EDIT = "edit", ARCHIVE = "archive" }

//
// Contacts — the account's light-CRM contact list. Lists contacts (name + reach + status), creates a contact
// via a dialog, and archives one (soft, confirmed). Reads/writes go through the contact service's /contacts
// endpoints (USER-gated). First cut: no filtering/segment-join UI yet.
//
export function ContactsList( _props : ContactsList.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [contacts,setContacts] = React.useState< Array<Contact.Entity> >( [] );
    const [page,setPage]         = React.useState< Paging.Page | null >( null );
    const [loading,setLoading]   = React.useState< boolean >( true );
    const [search,setSearch]     = React.useState< string >( "" );
    const [editOpen,setEditOpen] = React.useState< boolean >( false );
    const [editTarget,setEditTarget] = React.useState< Contact.Entity | null >( null );   // null while open = create
    const [archive,setArchive]   = React.useState< Contact.Entity | null >( null );   // pending archive → confirm
    const [snack,setSnack]       = React.useState< { message : string; severity : SnackAlert.Severity } | null >( null );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( () => { void load(); }, [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // load a page of the acting account's contacts (token paging — TableInput drives next via onNext)
    async function load( token? : string ) : Promise<void>
    {
        setLoading( true );
        const reply : RestfulService.Reply<GetContacts.Response> = await appmodel.server.fetch( new GetContacts( { start: token } ) );
        if( reply.ok && reply.data ) { setContacts( reply.data.records ); setPage( reply.data.page ); }
        setLoading( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // open the editor to ADD a new contact
    function openCreate() : void
    {
        setEditTarget( null );
        setEditOpen( true );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // open the editor to EDIT an existing contact
    function openEdit( contact : Contact.Entity ) : void
    {
        setEditTarget( contact );
        setEditOpen( true );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // save the editor — PATCH when editing an existing contact, else POST a new one; reload + snack on success
    async function onSave( contact : Contact.CreateContact ) : Promise<boolean>
    {
        const reply : RestfulService.Reply<PostContact.Response> = editTarget
            ? await appmodel.server.fetch( new PatchContact( editTarget.id, contact ) )
            : await appmodel.server.fetch( new PostContact( contact ) );
        if( reply.ok && reply.data )
        {
            setEditOpen( false );
            setSnack( { message: editTarget ? "Contact saved." : "Contact added.", severity: "success" } );
            void load();
            return true;
        }
        setSnack( { message: "Could not save the contact. Please try again.", severity: "error" } );
        return false;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the archive confirm's action: on YES archive the pending contact (snack + reload); any action dismisses
    async function onArchiveAction( action : AlertPrompt.Action ) : Promise<void>
    {
        if( archive && action === AlertPrompt.Action.YES )
        {
            const reply : RestfulService.Reply<DeleteContact.Response> = await appmodel.server.fetch( new DeleteContact( archive.id ) );
            if( reply.ok ) { setSnack( { message: "Contact archived.", severity: "success" } ); void load(); }
            else setSnack( { message: "Could not archive the contact. Please try again.", severity: "error" } );
        }
        setArchive( null );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a row action → edit the contact, or open the archive confirm
    function onContactAction( action : string, row : TableInput.Row ) : void
    {
        const contact : Contact.Entity | undefined = contacts.find( ( entry : Contact.Entity ) => entry.id === row.id );
        if( !contact ) return;
        if( action === ContactAction.EDIT )    openEdit( contact );
        if( action === ContactAction.ARCHIVE ) setArchive( contact );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // case-insensitive match of a contact against the search box (name / any email / any phone)
    function matchesSearch( contact : Contact.Entity ) : boolean
    {
        const needle : string = search.trim().toLowerCase();
        if( needle === "" ) return true;
        const hay : string = [
            contact.firstName ?? "",
            contact.lastName ?? "",
            ...contact.emails.map( ( entry : Contact.EmailEntry ) : string => entry.value ),
            ...contact.phones.map( ( entry : Contact.PhoneEntry ) : string => entry.value ),
        ].join( " " ).toLowerCase();
        return hay.includes( needle );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // display name for a contact (falls back to its default email/phone, then a placeholder)
    function displayName( contact : Contact.Entity ) : string
    {
        const name : string = [ contact.firstName, contact.lastName ].filter( ( part ) => !!part ).join( " " ).trim();
        if( name !== "" ) return name;
        return contact.emails[ 0 ]?.value ?? contact.phones[ 0 ]?.value ?? "(no name)";
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // status cell — a uniform status chip (central Colors.Status → theme color)
    function statusRenderer( _col : TableInput.Column, row : TableInput.Row ) : JSX.Element
    {
        return <ChipStatus size="small" label={ String( row.status ) } status={ statusColor( row.status as Contact.ContactStatus ) } />;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // map a contact lifecycle status → a central color status
    function statusColor( status : Contact.ContactStatus ) : Colors.Status
    {
        switch( status )
        {
            case Contact.ContactStatus.ACTIVE:   return Colors.Status.ACTIVE;
            case Contact.ContactStatus.PENDING:  return Colors.Status.PENDING;
            case Contact.ContactStatus.DELETED:  return Colors.Status.ERROR;
            default:                             return Colors.Status.INACTIVE;   // archived / forgotten
        }
    }

    // ── TableInput config ──────────────────────────────────────────────────────────────────────
    const contactActions : Array<TableInput.Action> =
    [
        { id: ContactAction.EDIT,    label: "Edit",    icon: <EditOutlinedIcon fontSize="small" /> },
        { id: ContactAction.ARCHIVE, label: "Archive", icon: <ArchiveOutlinedIcon fontSize="small" /> },
    ];

    // rows filtered by the search box (active contacts always editable; archived can't re-archive)
    const visible : Array<Contact.Entity> = contacts.filter( ( contact : Contact.Entity ) : boolean => matchesSearch( contact ) );

    const contactColumns : Array<TableInput.Column> =
    [
        { field: "ref",     label: "#",      type: TableInput.ColumnType.NUMBER },
        { field: "name",    label: "Name",   type: TableInput.ColumnType.STRING },
        { field: "email",   label: "Email",  type: TableInput.ColumnType.EMAIL },
        { field: "phone",   label: "Phone",  type: TableInput.ColumnType.PHONE },
        { field: "status",  label: "Status", type: TableInput.ColumnType.CUSTOM, renderer: statusRenderer },
        { field: "actions", label: "",       type: TableInput.ColumnType.ACTION },
    ];

    const contactRows : Array<TableInput.Row> = visible.map( ( contact : Contact.Entity ) => ( {
        id:      contact.id,
        ref:     contact.ref ?? null,
        name:    displayName( contact ),
        email:   contact.emails[ 0 ]?.value ?? "",
        phone:   contact.phones[ 0 ]?.value ?? "",
        status:  contact.status,
        actions: contact.status === Contact.ContactStatus.ACTIVE ? [ ContactAction.EDIT, ContactAction.ARCHIVE ] : [ ContactAction.EDIT ],
    } ) );

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <AuthPage minAccess={ Access.AccountRole.USER } title={"Contacts"}>
                <Box sx={{ p: 2, mx: "auto" }}>
                    <Card variant="outlined">
                        <CardHeader title={"Contacts"}
                                    subheader={"People in this account — the audience your segments and campaigns target."}
                                    action={
                                        <Stack direction="row" spacing={ 1 } sx={{ mt: 1, mr: 1, alignItems: "center" }}>
                                            <SearchInput id="contacts-search" label={"Search name, email, phone"} value={ search } onChange={ setSearch } sx={{ width: 220 }} />
                                            <ButtonIcon id="contacts-refresh" label={"Refresh"} size="small" disabled={ loading } icon={ <RefreshOutlinedIcon fontSize="small" /> } onClick={ () => void load() } />
                                            <Button variant="contained" size="small" startIcon={ <AddOutlinedIcon /> } onClick={ openCreate }>{"Add contact"}</Button>
                                            <HelpButton value={"5454594759475"} />
                                        </Stack>
                                    } />
                        <Divider />
                        <CardContent>
                            { loading &&
                                <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", p: 1 }}><CircularProgress size={ 18 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading…"}</Typography></Stack> }
                            { !loading && contacts.length === 0 &&
                                <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center", pt: 3, pb: 1 }}>{"No contacts yet. Add one to start building your audience."}</Typography> }
                            { !loading && contacts.length > 0 && visible.length === 0 &&
                                <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center", pt: 3, pb: 1 }}>{"No contacts match your search."}</Typography> }
                            { !loading && visible.length > 0 &&
                                <TableInput id="contacts-list"
                                            columns={ contactColumns }
                                            data={ contactRows }
                                            actions={ contactActions }
                                            onAction={ onContactAction }
                                            selectable={ TableInput.Selectable.NONE }
                                            paging={ TableInput.Paging.TOKEN }
                                            total={ page?.total }
                                            next={ page?.next }
                                            onNext={ ( token : string ) : void => void load( token ) } /> }
                        </CardContent>
                    </Card>
                </Box>

                <AccountChange onClear={ () => setContacts( [] ) } onRefresh={ () => void load() } />

                { editOpen &&
                    <ContactEditDialog contact={ editTarget ?? undefined } onSave={ onSave } onClose={ () => setEditOpen( false ) } /> }

                { archive &&
                    <AlertPrompt id="contacts-archive"
                                 type={ AlertPrompt.Type.WARNING }
                                 title={"Archive contact"}
                                 message={ `Archive "${ displayName( archive ) }"? They'll be hidden from lists but kept for audit and can be restored.` }
                                 yesText={"Archive"}
                                 cancelText={"Cancel"}
                                 onAction={ onArchiveAction } /> }

                { snack && <SnackAlert message={ snack.message } severity={ snack.severity } onClose={ () => setSnack( null ) } /> }
            </AuthPage>;
}

export namespace ContactsList
{
    export interface Props
    {
    }
}

export default ContactsList;
