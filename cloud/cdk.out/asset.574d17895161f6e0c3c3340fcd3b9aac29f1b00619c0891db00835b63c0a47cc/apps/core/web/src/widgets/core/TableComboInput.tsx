//
import React from 'react';
import { JSX } from "react";


//
import TableInput       from "./TableInput";
import BrowserUtils     from "@utils/BrowserUtils";
import MobileListInput  from "./MobileListInput";


//
//
//
export function TableComboInput( props : TableComboInput.Props ) : JSX.Element
{

    ///////////////////////////////////////////////////////////////////////////////////
    function column( field : string | undefined ): TableInput.Column | undefined
    {
        if( !props.columns || field === undefined )return undefined;
        return props.columns.find((col: TableInput.Column) => col.field === field);
    }

     // ===============================================================================================
    return <section>
            { BrowserUtils.isMobile ?
                <MobileListInput    id      = { props.id }
                                    maxLeft = { props.maxLeft ? props.maxLeft : 150 }

                                    disabled = { props.disabled }

                                    offset  = { props.offset }
                                    count   = { props.count }
                                    total   = { props.total }

                                    paging = { props.paging }
                                    next   = { props.next }
    
                                    primary=    {   {
                                                        upper : column( props.primary.upper ),
                                                        lower : column( props.primary.lower ),
                                                        right : column( props.primary.right )
                                                    }
                                                }
                                    secondary=  {   {
                                                        upper : props.secondary ? column( props.secondary.upper ) : undefined,
                                                        lower : props.secondary ? column( props.secondary.lower ) : undefined
                                                    }
                                                }
    
                                    actions={ props.actions }
    
                                    data        = { props.data }
                                    onOffset    = { props.onOffset }
                                    onAction    = { props.onAction }
                                    onNext      = { props.onNext }
                            />
    
            :
                <TableInput {...props} /> 
            }
        </section>;

   
}

export namespace TableComboInput
{
    export interface Props extends TableInput.Props
    {
        // mobile mapping
        maxLeft?    : number;
        primary     : { upper : string, lower? : string; right? : string };
        secondary?  : { upper? : string, lower? : string };
    }
}


export default TableComboInput;
// eof