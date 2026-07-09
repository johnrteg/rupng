import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Button, Divider, Stack, Tab, Tabs, Typography } from "@mui/material";
import AddOutlinedIcon           from '@mui/icons-material/AddOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';

import { Type, PhoneUtils } from '@repo/common';
import { Contact, GetContactFields } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import DialogWindow    from '@widgets/core/DialogWindow';
import ButtonIcon      from '@widgets/core/ButtonIcon';
import TextInput       from '@widgets/core/TextInput';
import EmailInput      from '@widgets/core/EmailInput';
import TelephoneInput  from '@widgets/core/TelephoneInput';
import SelectInput     from '@widgets/core/SelectInput';
import SelectMultInput from '@widgets/core/SelectMultInput';
import NumericInput    from '@widgets/core/NumericInput';
import CheckboxInput   from '@widgets/core/CheckboxInput';
import DateInput       from '@widgets/core/DateInput';
import DateTimeInput   from '@widgets/core/DateTimeInput';
import UrlInput        from '@widgets/core/UrlInput';
import TagInput        from '@widgets/core/TagInput';
import TimezoneInput   from '@widgets/core/TimezoneInput';
import AddressInput    from '@widgets/app/AddressInput';

// common preferred-language choices (BCP-47). A short curated set — extend as the account's languages grow.
const LANGUAGE_CHOICES : Array<SelectInput.Choice> =
[
    { value: "en", label: "English" },
    { value: "es", label: "Spanish" },
    { value: "fr", label: "French" },
    { value: "de", label: "German" },
    { value: "pt", label: "Portuguese" },
    { value: "zh", label: "Chinese" },
    { value: "vi", label: "Vietnamese" },
];

//
// ContactEditDialog — create OR edit a contact. One dialog for both: pass `contact` to edit (PATCH), omit to
// create (POST); the parent picks the endpoint in onSave. Supports 1..N emails (with a context), 1..N phones
// (TelephoneInput + a type), and 1..N addresses (with a type). The parent owns open/close + does the fetch.
//
export function ContactEditDialog( props : ContactEditDialog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const editing : boolean = props.contact !== undefined;

    const [tab,setTab]             = React.useState< number >( 0 );   // 0 Details · 1 Custom · 2 Consent · 3 Segments · 4 Notes · 5 Sync
    const [firstName,setFirstName] = React.useState< string >( props.contact?.firstName ?? "" );
    const [lastName,setLastName]   = React.useState< string >( props.contact?.lastName ?? "" );
    const [notes,setNotes]         = React.useState< string >( props.contact?.notes ?? "" );
    const [tagValues,setTagValues] = React.useState< Array<string> >( ( props.contact?.tags ?? [] ).map( ( tag : Contact.Tag ) : string => tag.value ) );
    const [emails,setEmails]       = React.useState< Array<Contact.EmailEntry> >( props.contact?.emails ?? [] );
    const [phones,setPhones]       = React.useState< Array<Contact.PhoneEntry> >( props.contact?.phones ?? [] );
    const [addresses,setAddresses] = React.useState< Array<Contact.AddressEntry> >( props.contact?.addresses ?? [] );

    // demographics / geo / language
    const [sex,setSex]             = React.useState< string >( props.contact?.sex ?? "" );
    const [party,setParty]         = React.useState< string >( props.contact?.politicalParty ?? "" );
    const [birthdate,setBirthdate] = React.useState< Date | null >( props.contact?.estimatedBirthdate ? new Date( props.contact.estimatedBirthdate ) : null );
    const [language,setLanguage]   = React.useState< string >( props.contact?.preferredLanguage ?? "en" );   // default English
    const [tz,setTz]               = React.useState< string >( props.contact?.tz ?? "" );

    // external-system links (sync/dedup) — READ-ONLY here; shown as { system, id } rows, preserved on save
    const externals : Array<{ system : string; id : string }> =
        Object.entries( props.contact?.externalRefs ?? {} ).map( ( [ system, ref ] : [ string, Contact.ExternalRef ] ) : { system : string; id : string } => ( { system, id: ref.id } ) );

    // per-channel consent — the effective (latest-dated) state per channel, editable in the editor
    const [consent,setConsent]     = React.useState< Partial<Record<Contact.Channel, string>> >( () => effectiveConsent() );

    // account custom-field DEFS + this contact's values (values are stored as strings, keyed by field uid)
    const [fieldDefs,setFieldDefs] = React.useState< Array<Contact.CustomFieldDef> >( [] );
    const [customFields,setCustomFields] = React.useState< Contact.CustomFieldValues >( props.contact?.customFields ?? {} );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( () => { void loadFields(); }, [] );

    // load the account's active custom-field definitions to render the grouped custom-field editor
    async function loadFields() : Promise<void>
    {
        const reply : RestfulService.Reply<GetContactFields.Response> = await appmodel.server.fetch( new GetContactFields() );
        if( reply.ok && reply.data ) setFieldDefs( reply.data.records );
    }

    // a custom field's current string value (empty when unset)
    function cfValue( uid : string ) : string { return customFields[ uid ] ?? ""; }
    // set a custom field's string value
    function setCf( uid : string, value : string ) : void { setCustomFields( ( prev : Contact.CustomFieldValues ) => ( { ...prev, [ uid ]: value } ) ); }

    // context / type dropdown choices, straight off the model enums (single source)
    const emailContexts : Array<SelectInput.Choice> = SelectInput.enumToChoices( Contact.EmailContext );
    const phoneTypes    : Array<SelectInput.Choice> = SelectInput.enumToChoices( Contact.PhoneType );
    const addressTypes  : Array<SelectInput.Choice> = SelectInput.enumToChoices( Contact.AddressType );
    const sexChoices    : Array<SelectInput.Choice> = SelectInput.enumToChoices( Contact.Sex );
    const partyChoices  : Array<SelectInput.Choice> = SelectInput.enumToChoices( Contact.PoliticalParty );
    const consentChoices : Array<SelectInput.Choice> = SelectInput.enumToChoices( Contact.ConsentState );
    const consentChannels : Array<Contact.Channel> = Object.values( Contact.Channel );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the EFFECTIVE consent state per channel (the latest-dated record; UNKNOWN when none) — seeds the editor
    function effectiveConsent() : Partial<Record<Contact.Channel, string>>
    {
        const out : Partial<Record<Contact.Channel, string>> = {};
        for( const channel of Object.values( Contact.Channel ) )
        {
            const records : Array<Contact.ConsentRecord> = ( props.contact?.consent ?? [] ).filter( ( record : Contact.ConsentRecord ) : boolean => record.channel === channel );
            out[ channel ] = records.length === 0 ? Contact.ConsentState.UNKNOWN
                : records.reduce( ( best : Contact.ConsentRecord, record : Contact.ConsentRecord ) : Contact.ConsentRecord => record.at > best.at ? record : best ).state;
        }
        return out;
    }
    function setChannelConsent( channel : Contact.Channel, state : string ) : void
    {
        setConsent( ( prev ) => ( { ...prev, [ channel ]: state } ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── emails ──────────────────────────────────────────────────────────────────────────────
    function addEmail() : void
    {
        setEmails( ( prev : Array<Contact.EmailEntry> ) => [ ...prev, { value: "" as Type.Email, context: Contact.EmailContext.HOME, isDefault: prev.length === 0 } ] );
    }
    function removeEmail( index : number ) : void
    {
        setEmails( ( prev : Array<Contact.EmailEntry> ) => prev.filter( ( _entry : Contact.EmailEntry, at : number ) : boolean => at !== index ) );
    }
    function setEmailValue( index : number, value : string ) : void
    {
        setEmails( ( prev : Array<Contact.EmailEntry> ) => prev.map( ( entry : Contact.EmailEntry, at : number ) : Contact.EmailEntry => at === index ? { ...entry, value: value as Type.Email } : entry ) );
    }
    function setEmailContext( index : number, context : string ) : void
    {
        setEmails( ( prev : Array<Contact.EmailEntry> ) => prev.map( ( entry : Contact.EmailEntry, at : number ) : Contact.EmailEntry => at === index ? { ...entry, context: context as Contact.EmailContext } : entry ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── phones ──────────────────────────────────────────────────────────────────────────────
    function addPhone() : void
    {
        setPhones( ( prev : Array<Contact.PhoneEntry> ) => [ ...prev, { value: "" as Type.PhoneE164, type: Contact.PhoneType.CELL, isDefault: prev.length === 0 } ] );
    }
    function removePhone( index : number ) : void
    {
        setPhones( ( prev : Array<Contact.PhoneEntry> ) => prev.filter( ( _entry : Contact.PhoneEntry, at : number ) : boolean => at !== index ) );
    }
    function setPhoneValue( index : number, value : string ) : void
    {
        setPhones( ( prev : Array<Contact.PhoneEntry> ) => prev.map( ( entry : Contact.PhoneEntry, at : number ) : Contact.PhoneEntry => at === index ? { ...entry, value: value as Type.PhoneE164 } : entry ) );
    }
    function setPhoneType( index : number, type : string ) : void
    {
        setPhones( ( prev : Array<Contact.PhoneEntry> ) => prev.map( ( entry : Contact.PhoneEntry, at : number ) : Contact.PhoneEntry => at === index ? { ...entry, type: type as Contact.PhoneType } : entry ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── addresses ───────────────────────────────────────────────────────────────────────────
    // the contact AddressEntry field names differ from @repo/common Type.Address — map both ways
    function toAddress( entry : Contact.AddressEntry ) : Type.Address
    {
        return { street1: entry.line1 ?? "", street2: entry.line2 ?? "", city: entry.city ?? "", state: entry.region ?? "", zip: entry.postalCode ?? "", country: entry.country ?? "", location: { lat: entry.latitude, lng: entry.longitude } };
    }
    function addAddress() : void
    {
        setAddresses( ( prev : Array<Contact.AddressEntry> ) => [ ...prev, { type: Contact.AddressType.HOME, isDefault: prev.length === 0 } ] );
    }
    function removeAddress( index : number ) : void
    {
        setAddresses( ( prev : Array<Contact.AddressEntry> ) => prev.filter( ( _entry : Contact.AddressEntry, at : number ) : boolean => at !== index ) );
    }
    function setAddressType( index : number, type : string ) : void
    {
        setAddresses( ( prev : Array<Contact.AddressEntry> ) => prev.map( ( entry : Contact.AddressEntry, at : number ) : Contact.AddressEntry => at === index ? { ...entry, type: type as Contact.AddressType } : entry ) );
    }
    function setAddressValue( index : number, address : Type.Address ) : void
    {
        setAddresses( ( prev : Array<Contact.AddressEntry> ) => prev.map( ( entry : Contact.AddressEntry, at : number ) : Contact.AddressEntry =>
            at === index ? { ...entry, line1: address.street1, line2: address.street2, city: address.city, region: address.state, postalCode: address.zip, country: address.country, latitude: address.location?.lat, longitude: address.location?.lng } : entry ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a contact needs a name or at least one filled email/phone
    function isReady() : boolean
    {
        const hasEmail : boolean = emails.some( ( entry : Contact.EmailEntry ) : boolean => entry.value.trim() !== "" );
        const hasPhone : boolean = phones.some( ( entry : Contact.PhoneEntry ) : boolean => entry.value.trim() !== "" );
        return firstName.trim() !== "" || lastName.trim() !== "" || hasEmail || hasPhone;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // drop empty rows, then hand the assembled contact to the parent (which POSTs or PATCHes)
    function onYes() : Promise<boolean>
    {
        const cleanEmails : Array<Contact.EmailEntry> = emails.filter( ( entry : Contact.EmailEntry ) : boolean => entry.value.trim() !== "" );
        // normalize phones to E.164 on save (so the library's PHONE column formats them); keep raw if unparseable
        const cleanPhones : Array<Contact.PhoneEntry> = phones
            .filter( ( entry : Contact.PhoneEntry ) : boolean => entry.value.trim() !== "" )
            .map( ( entry : Contact.PhoneEntry ) : Contact.PhoneEntry =>
            {
                const normalized : Type.Result<Type.PhoneE164> = PhoneUtils.toE164( entry.value );
                return normalized.ok ? { ...entry, value: normalized.data } : entry;
            } );
        const cleanAddresses : Array<Contact.AddressEntry> = addresses.filter( ( entry : Contact.AddressEntry ) : boolean => !!( entry.line1 || entry.city || entry.postalCode ) );
        // external links → an ExternalRefs object keyed by system (drop rows missing a system or id)
        const externalRefs : Contact.ExternalRefs = {};
        for( const row of externals )
            if( row.system.trim() !== "" && row.id.trim() !== "" ) externalRefs[ row.system.trim() ] = { id: row.id.trim() };
        // contact-level geo now follows the DEFAULT address's coordinates (lat/lon is set per-address)
        const geoAddress : Contact.AddressEntry | undefined = cleanAddresses.find( ( entry : Contact.AddressEntry ) : boolean => entry.isDefault ) ?? cleanAddresses[ 0 ];
        // consent: append a record for each channel whose state was changed in the editor (latest-wins log)
        const priorConsent : Array<Contact.ConsentRecord> = props.contact?.consent ?? [];
        const effective : Partial<Record<Contact.Channel, string>> = effectiveConsent();
        const nowIso : Type.ISODateTime = new Date().toISOString();
        const consentAppends : Array<Contact.ConsentRecord> = consentChannels
            .filter( ( channel : Contact.Channel ) : boolean => !!consent[ channel ] && consent[ channel ] !== effective[ channel ] )
            .map( ( channel : Contact.Channel ) : Contact.ConsentRecord => ( { channel, state: consent[ channel ] as Contact.ConsentState, source: "ui", at: nowIso } ) );
        const consentLog : Array<Contact.ConsentRecord> = [ ...priorConsent, ...consentAppends ];
        return props.onSave( {
            firstName: firstName.trim() || undefined,
            lastName:  lastName.trim()  || undefined,
            notes:     notes.trim()     || undefined,
            emails:    cleanEmails,
            phones:    cleanPhones,
            addresses: cleanAddresses.length > 0 ? cleanAddresses : undefined,
            tags:      tagValues.map( ( value : string ) : Contact.Tag => ( { namespace: Contact.TagNamespace.ACCOUNT, value } ) ),
            sex:            sex !== ""   ? sex as Contact.Sex : undefined,
            politicalParty: party !== "" ? party as Contact.PoliticalParty : undefined,
            estimatedBirthdate: birthdate ? birthdate.toISOString().slice( 0, 10 ) : undefined,
            preferredLanguage:  language !== "" ? language : undefined,
            tz:        tz !== "" ? tz as Type.TimeZone : undefined,
            latitude:  geoAddress?.latitude,
            longitude: geoAddress?.longitude,
            externalRefs: Object.keys( externalRefs ).length > 0 ? externalRefs : undefined,
            consent:      consentLog.length > 0 ? consentLog : undefined,
            customFields: Object.keys( customFields ).length > 0 ? customFields : undefined,
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // one typed input for a custom field (value is always stored as a string; the def's type picks the control)
    function customFieldInput( def : Contact.CustomFieldDef ) : JSX.Element
    {
        const id : string = `cf-${ def.uid }`;
        if( def.type === Contact.CustomFieldType.NUMBER || def.type === Contact.CustomFieldType.CURRENCY )
            return <NumericInput id={ id } label={ def.label } value={ Number( cfValue( def.uid ) ) || 0 } onChange={ ( value : number ) : void => setCf( def.uid, String( value ) ) } />;
        if( def.type === Contact.CustomFieldType.BOOLEAN )
            return <CheckboxInput id={ id } label={ def.label } value={ cfValue( def.uid ) === "true" } onChange={ ( value : boolean ) : void => setCf( def.uid, String( value ) ) } />;
        if( def.type === Contact.CustomFieldType.CHOICE )
            return <SelectInput id={ id } label={ def.label } value={ cfValue( def.uid ) }
                                choices={ ( def.choices ?? [] ).map( ( option : Contact.ChoiceOption ) : SelectInput.Choice => ( { value: option.key, label: option.label } ) ) }
                                onChange={ ( value : string ) : void => setCf( def.uid, value ) } sx={{ width: "100%" }} />;
        if( def.type === Contact.CustomFieldType.MULTI_CHOICE )
            return <SelectMultInput id={ id } label={ def.label } value={ cfValue( def.uid ) === "" ? [] : cfValue( def.uid ).split( "," ) }
                                    choices={ ( def.choices ?? [] ).map( ( option : Contact.ChoiceOption ) : SelectMultInput.Choice => ( { value: option.key, label: option.label } ) ) }
                                    onChange={ ( values : Array<string> ) : void => setCf( def.uid, values.join( "," ) ) } minWidth="100%" />;
        if( def.type === Contact.CustomFieldType.DATE )
            return <DateInput id={ id } label={ def.label } value={ cfValue( def.uid ) ? new Date( cfValue( def.uid ) ) : null }
                              onChange={ ( value : Date | null ) : void => setCf( def.uid, value ? value.toISOString().slice( 0, 10 ) : "" ) } />;
        if( def.type === Contact.CustomFieldType.DATETIME )
            return <DateTimeInput id={ id } label={ def.label } value={ cfValue( def.uid ) ? new Date( cfValue( def.uid ) ) : null }
                                  onChange={ ( value : Date | null ) : void => setCf( def.uid, value ? value.toISOString() : "" ) } sx={{ width: "100%" }} />;
        if( def.type === Contact.CustomFieldType.URL )
            return <UrlInput id={ id } label={ def.label } value={ cfValue( def.uid ) } onChange={ ( value : string ) : void => setCf( def.uid, value ) } />;
        if( def.type === Contact.CustomFieldType.EMAIL )
            return <EmailInput id={ id } label={ def.label } value={ cfValue( def.uid ) } onChange={ ( value : string ) : void => setCf( def.uid, value ) } sx={{ width: "100%" }} />;
        if( def.type === Contact.CustomFieldType.PHONE )
            return <TelephoneInput id={ id } label={ def.label } value={ cfValue( def.uid ) } onChange={ ( value : string ) : void => setCf( def.uid, value ) } fullWidth />;
        // TEXT / MULTILINE → a text field (multiline for MULTILINE)
        return <TextInput id={ id } label={ def.label } value={ cfValue( def.uid ) } onChange={ ( value : string ) : void => setCf( def.uid, value ) }
                          fullWidth multiline={ def.type === Contact.CustomFieldType.MULTILINE } maxRows={ def.type === Contact.CustomFieldType.MULTILINE ? 4 : 1 } />;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the custom-field defs grouped by their `group` label (in the order the API returned them)
    function fieldGroups() : Array<{ group : string; defs : Array<Contact.CustomFieldDef> }>
    {
        const groups : Array<{ group : string; defs : Array<Contact.CustomFieldDef> }> = [];
        for( const def of fieldDefs )
        {
            const label : string = def.group ?? "Other";
            const bucket : { group : string; defs : Array<Contact.CustomFieldDef> } | undefined = groups.find( ( entry ) => entry.group === label );
            if( bucket ) bucket.defs.push( def );
            else groups.push( { group: label, defs: [ def ] } );
        }
        return groups;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a small "＋ Add X" / section header row
    function sectionHeader( label : string, onAdd : () => void ) : JSX.Element
    {
        return  <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}>
                    <Typography variant="overline" sx={{ color: "text.secondary" }}>{ label }</Typography>
                    <Box sx={{ flexGrow: 1 }} />
                    <Button size="small" startIcon={ <AddOutlinedIcon /> } onClick={ onAdd }>{"Add"}</Button>
                </Stack>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="contact-edit"
                          title={ editing ? "Edit contact" : "Add contact" }
                          yesLabel={ editing ? "Save" : "Add contact" }
                          cancelLabel={"Cancel"}
                          minWidth="md"
                          ready={ isReady() }
                          onYes={ onYes }
                          onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2 }}>
                    <Tabs value={ tab } onChange={ ( _event : React.SyntheticEvent, value : number ) : void => setTab( value ) }>
                        <Tab label={"Details"} /><Tab label={"Custom"} /><Tab label={"Consent"} /><Tab label={"Segments"} /><Tab label={"Notes"} /><Tab label={"Sync"} />
                    </Tabs>

                    {/* ── Details ─────────────────────────────────────────────────────────────────── */}
                    { tab === 0 &&
                        <Stack spacing={ 2 }>
                            <Stack direction="row" spacing={ 1 }>
                                <TextInput id="contact-first" label={"First name"} value={ firstName } onChange={ setFirstName } maxLength={ 100 } fullWidth />
                                <TextInput id="contact-last"  label={"Last name"}  value={ lastName }  onChange={ setLastName }  maxLength={ 100 } fullWidth />
                            </Stack>
                            <TagInput id="contact-tags" size="small" label={"Tags"} value={ tagValues } choices={ [] } onChange={ setTagValues } />
                            {/* details — two columns: sex/party, language/birthdate, timezone */}
                            <Stack direction="row" spacing={ 1 }>
                                <Box sx={{ width: "50%" }}><SelectInput id="contact-sex" label={"Sex"} value={ sex } choices={ [ { value: "", label: "(unset)" }, ...sexChoices ] } onChange={ setSex } sx={{ width: "100%" }} /></Box>
                                <Box sx={{ width: "50%" }}><SelectInput id="contact-party" label={"Political party"} value={ party } choices={ [ { value: "", label: "(unset)" }, ...partyChoices ] } onChange={ setParty } sx={{ width: "100%" }} /></Box>
                            </Stack>
                            <Stack direction="row" spacing={ 1 }>
                                <Box sx={{ width: "50%" }}><SelectInput id="contact-language" label={"Preferred language"} value={ language } choices={ [ { value: "", label: "(unset)" }, ...LANGUAGE_CHOICES ] } onChange={ setLanguage } sx={{ width: "100%" }} /></Box>
                                <Box sx={{ width: "50%" }}><DateInput id="contact-birthdate" label={"Birthdate"} value={ birthdate } onChange={ ( value : Date | null ) : void => setBirthdate( value ) } /></Box>
                            </Stack>
                            <Stack direction="row" spacing={ 1 }>
                                <Box sx={{ width: "50%" }}><TimezoneInput id="contact-tz" label={"Timezone"} value={ tz ? [ tz ] : [] } valueType={ TimezoneInput.ValueType.CITY } labelType={ TimezoneInput.LabelType.CITY } onChange={ ( values : Array<string> ) : void => setTz( values[ 0 ] ?? "" ) } /></Box>
                                <Box sx={{ width: "50%" }} />
                            </Stack>

                            <Divider />
                            { sectionHeader( "Emails", addEmail ) }
                            { emails.map( ( entry : Contact.EmailEntry, index : number ) : JSX.Element => (
                                <Stack key={ `email-${ index }` } direction="row" spacing={ 1 } sx={{ alignItems: "flex-start" }}>
                                    <Box sx={{ flexGrow: 1 }}><EmailInput id={ `email-${ index }` } label={"Email"} value={ entry.value } onChange={ ( value : string ) : void => setEmailValue( index, value ) } sx={{ width: "100%" }} /></Box>
                                    <SelectInput id={ `email-context-${ index }` } label={"Context"} value={ entry.context } choices={ emailContexts } onChange={ ( value : string ) : void => setEmailContext( index, value ) } sx={{ width: 140 }} />
                                    <Box sx={{ mt: 1 }}><ButtonIcon id={ `email-rm-${ index }` } label={"Remove"} size="small" icon={ <DeleteOutlineOutlinedIcon fontSize="small" /> } onClick={ () => removeEmail( index ) } /></Box>
                                </Stack>
                            ) ) }

                            <Divider />
                            { sectionHeader( "Phones", addPhone ) }
                            { phones.map( ( entry : Contact.PhoneEntry, index : number ) : JSX.Element => (
                                <Stack key={ `phone-${ index }` } direction="row" spacing={ 1 } sx={{ alignItems: "flex-start" }}>
                                    <Box sx={{ flexGrow: 1 }}><TelephoneInput id={ `phone-${ index }` } label={"Phone"} value={ entry.value } onChange={ ( value : string ) : void => setPhoneValue( index, value ) } fullWidth /></Box>
                                    <SelectInput id={ `phone-type-${ index }` } label={"Type"} value={ entry.type } choices={ phoneTypes } onChange={ ( value : string ) : void => setPhoneType( index, value ) } sx={{ width: 140 }} />
                                    <Box sx={{ mt: 1 }}><ButtonIcon id={ `phone-rm-${ index }` } label={"Remove"} size="small" icon={ <DeleteOutlineOutlinedIcon fontSize="small" /> } onClick={ () => removePhone( index ) } /></Box>
                                </Stack>
                            ) ) }

                            <Divider />
                            { sectionHeader( "Addresses", addAddress ) }
                            { addresses.map( ( entry : Contact.AddressEntry, index : number ) : JSX.Element => (
                                <Stack key={ `address-${ index }` } spacing={ 1 } sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, p: 1 }}>
                                    <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}>
                                        <SelectInput id={ `address-type-${ index }` } label={"Type"} value={ entry.type } choices={ addressTypes } onChange={ ( value : string ) : void => setAddressType( index, value ) } sx={{ width: 140 }} />
                                        <Box sx={{ flexGrow: 1 }} />
                                        <ButtonIcon id={ `address-rm-${ index }` } label={"Remove"} size="small" icon={ <DeleteOutlineOutlinedIcon fontSize="small" /> } onClick={ () => removeAddress( index ) } />
                                    </Stack>
                                    <AddressInput id={ `address-${ index }` } value={ toAddress( entry ) } onChange={ ( address : Type.Address ) : void => setAddressValue( index, address ) } />
                                </Stack>
                            ) ) }
                        </Stack> }

                    {/* ── Custom fields ───────────────────────────────────────────────────────────── */}
                    { tab === 1 &&
                        <Stack spacing={ 2 }>
                            { fieldDefs.length === 0 &&
                                <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center", pt: 3 }}>{"No custom fields defined. Add them under Settings → Contacts."}</Typography> }
                            { fieldGroups().map( ( entry : { group : string; defs : Array<Contact.CustomFieldDef> } ) : JSX.Element => (
                                <Box key={ `cfg-${ entry.group }` }>
                                    <Typography variant="overline" sx={{ color: "text.secondary" }}>{ entry.group }</Typography>
                                    <Stack spacing={ 2 } sx={{ mt: 0.5 }}>
                                        { entry.defs.map( ( def : Contact.CustomFieldDef ) : JSX.Element => (
                                            <Box key={ def.uid }>{ customFieldInput( def ) }</Box>
                                        ) ) }
                                    </Stack>
                                </Box>
                            ) ) }
                        </Stack> }

                    {/* ── Notes ───────────────────────────────────────────────────────────────────── */}
                    { tab === 4 &&
                        <Stack spacing={ 2 }>
                            <TextInput id="contact-notes" label={"Notes"} value={ notes } onChange={ setNotes } maxLength={ 2000 } fullWidth multiline maxRows={ 6 } />
                        </Stack> }

                    {/* ── Sync (external system links) — READ-ONLY for now (editing lands later) ─────── */}
                    { tab === 5 &&
                        <Stack spacing={ 2 }>
                            <Typography variant="overline" sx={{ color: "text.secondary" }}>{"External system links"}</Typography>
                            <Typography variant="caption" sx={{ color: "text.secondary" }}>{"Links to records in external systems (e.g. l2, mscrm) for sync + dedup. Read-only here — managed by sync; editing lands later."}</Typography>
                            { externals.length === 0 &&
                                <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center", pt: 2 }}>{"No external links."}</Typography> }
                            { externals.map( ( row : { system : string; id : string }, index : number ) : JSX.Element => (
                                <Stack key={ `ext-${ index }` } direction="row" spacing={ 1 } sx={{ alignItems: "center", border: "1px solid", borderColor: "divider", borderRadius: 1, p: 1 }}>
                                    <Typography variant="body2" sx={{ width: 160, color: "text.secondary" }}>{ row.system }</Typography>
                                    <Typography variant="body2" sx={{ flexGrow: 1, fontFamily: "monospace" }}>{ row.id }</Typography>
                                </Stack>
                            ) ) }
                        </Stack> }

                    {/* ── Consent ─────────────────────────────────────────────────────────────────── */}
                    { tab === 2 &&
                        <Stack spacing={ 2 }>
                            <Typography variant="caption" sx={{ color: "text.secondary" }}>{"Opt-in / opt-out per channel. Changing a channel records a new consent event; an opt-out is account-wide and permanent."}</Typography>
                            <Stack spacing={ 1 }>
                                { consentChannels.map( ( channel : Contact.Channel ) : JSX.Element => (
                                    <Stack key={ `consent-${ channel }` } direction="row" spacing={ 1 } sx={{ alignItems: "center" }}>
                                        <Typography variant="body2" sx={{ width: 80, textTransform: "capitalize", color: "text.secondary" }}>{ channel }</Typography>
                                        <Box sx={{ flexGrow: 1 }}><SelectInput id={ `consent-${ channel }` } label={"Consent"} value={ consent[ channel ] ?? Contact.ConsentState.UNKNOWN } choices={ consentChoices } onChange={ ( value : string ) : void => setChannelConsent( channel, value ) } sx={{ width: "100%" }} /></Box>
                                    </Stack>
                                ) ) }
                            </Stack>
                        </Stack> }

                    {/* ── Segments ─────────────────────────────────────────────────────────────────── */}
                    { tab === 3 &&
                        <Stack spacing={ 2 }>
                            <Typography variant="caption" sx={{ color: "text.secondary" }}>{"Segments this contact belongs to — add or remove the contact from segments here."}</Typography>
                            <Typography variant="body2" sx={{ color: "text.disabled", textAlign: "center", pt: 2 }}>{"Segment membership — coming next (needs the contact↔segment membership API)."}</Typography>
                        </Stack> }
                </Stack>
            </DialogWindow>;
}

export namespace ContactEditDialog
{
    export interface Props
    {
        contact? : Contact.Entity;                                       // present → edit (PATCH); absent → create (POST)
        onSave   : ( contact : Contact.CreateContact ) => Promise<boolean>;
        onClose  : () => void;
    }
}

export default ContactEditDialog;
