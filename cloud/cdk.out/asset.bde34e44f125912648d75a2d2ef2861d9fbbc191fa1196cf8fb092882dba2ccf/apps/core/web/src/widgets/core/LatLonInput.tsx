//
import React from 'react';
import { JSX } from "react";

//
import Stack            from '@mui/material/Stack';
import ButtonGroup      from '@mui/material/ButtonGroup';
import Button           from '@mui/material/Button';

//
import TravelExploreIcon from '@mui/icons-material/TravelExplore';

//
import TextInput        from './TextInput';
import ButtonIcon       from './ButtonIcon';
import BrowserUtils     from '@utils/BrowserUtils';
import { StringUtils } from '@repo/common';


//



export function LatLonInput( props: LatLonInput.Props ) : JSX.Element
{
    const [latStr,setLatStr]    = React.useState< string >( props.lat.toFixed(6) );
    const [lonStr,setLonStr]    = React.useState< string >( props.lon.toFixed(6) );
    const [ns,setNorthSouth]    = React.useState< "N" | "S" >( props.lat >= 0 ? "N" : "S" );
    const [ew,setEastWest]      = React.useState< "E" | "W" >( props.lon >= 0 ? "E" : "W" );

    //
    React.useEffect( onNSChange, [ns] );
    React.useEffect( onEWChange, [ew] );
    React.useEffect( () => onLoad(), [] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function onLoad() : void
    {
        onLatChange( props.lat.toString() );
        onLonChange( props.lon.toString() );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////
    function onLatChange( newStr: string ) : void
    {
        const num : number = parseFloat( newStr );
        if( !isNaN( num ) )
        {
            let lat : number = ( ns === "N" ? 1 : -1 ) * Math.abs( num );
            lat = Math.max( -90, Math.min( 90, lat ) );

            setLatStr( Math.abs( lat ).toString() );
            if( num < 0 )setNorthSouth( "S" );

            props.onChange?.( lat, getLon() );
        }
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////
    function onLonChange( newStr: string ) : void
    {
        const num : number = parseFloat( newStr );
        if( !isNaN( num ) )
        {
            let lon : number = ( ew === "E" ? 1 : -1 ) * Math.abs( num );
            lon = Math.max( -180, Math.min( 180, lon ) );

            setLonStr( Math.abs( lon ).toString() );
            if( num < 0 )setEastWest( "W" );

            props.onChange?.( getLat(), lon );
        }
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////
    function onNSChange( ) : void
    {
        const lat : number = ( ns === "N" ? 1 : -1 ) * Math.abs( parseFloat( latStr ) );
        props.onChange?.( lat, getLon() );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////
    function onEWChange() : void
    {
        const lon = ( ew === "E" ? 1 : -1) * Math.abs( parseFloat( lonStr ) );
        props.onChange?.(getLat(), lon);
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////
    function getLat() : number
    {
        const num = parseFloat( latStr );
        return isNaN( num ) ? 0 : (ns === "N" ? 1 : -1) * Math.abs( num );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////
    function getLon() : number
    {
        const num = parseFloat( lonStr );
        return isNaN( num ) ? 0 : ( ew === "E" ? 1 : -1) * Math.abs( num );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////
    function onMap() : void
    {
        const url : string = StringUtils.format( "https://www.google.com/maps/@{0},{1},12z", getLat().toString(), getLon().toString() );
        BrowserUtils.open( url );
    }



    return  <Stack direction={ props.direction } spacing={ props.direction == "row" ? 1 : 2 }>

                <TextInput  id={ props.id + "-lat" }
                            label={ props.latLabel }
                            noSpaces={ true }
                            allNumeric={ true }
                            align={"right"}
                            disabled={ props.disabled }
                            endIcon={ <ButtonGroup size="small" >{
                            [<Button key="north" variant={ ns == "N" ? "contained" : "outlined" } disabled={ props.disabled } size="small" onClick={ ()=> setNorthSouth("N") }>{"N"}</Button>,
                             <Button key="south" variant={ ns == "S" ? "contained" : "outlined" } disabled={ props.disabled } size="small" onClick={ ()=> setNorthSouth("S") }>{"S"}</Button>]}
                                    </ButtonGroup> }
                            value={ latStr }
                            onChange={ onLatChange }/>

                <TextInput  id={ props.id + "-lon" }
                            label={ props.lonLabel }
                            noSpaces={ true }
                            allNumeric={ true }
                            align={"right"}
                            disabled={ props.disabled }
                            endIcon={ <ButtonGroup size="small" >{
                            [<Button key="north" variant={ ew == "E" ? "contained" : "outlined" } disabled={ props.disabled } size="small" onClick={ ()=> setEastWest("E") } >{"E"}</Button>,
                             <Button key="south" variant={ ew == "W" ? "contained" : "outlined" } disabled={ props.disabled } size="small" onClick={ ()=> setEastWest("W") } >{"W"}</Button>]}
                                    </ButtonGroup> }
                            value={ lonStr }
                            onChange={ onLonChange }/>

                <ButtonIcon id={ props.id + "-map" } icon={ <TravelExploreIcon/> } label={ "Map" + StringUtils.ELLIPSE } onClick={ onMap } />
            </Stack>
    
}

export namespace LatLonInput
{
    export interface Props
    {
        id          : string;
        direction   : "row" | "column";
        latLabel    : string;
        lonLabel    : string;
        lat         : number;   // in degrees
        lon         : number;   // in degrees
        disabled?   : boolean;
        onChange?   : ( lat : number, lon : number ) => void;
    }
}


export default LatLonInput;
// eof