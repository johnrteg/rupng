
namespace SysConstants
{

    export namespace Time
    {
        export const SECONDS_TO_MS : number = 1000;
        export const MINUTES_TO_MS : number = 60000;
        export const HOURS_TO_MS : number = 3600000;
        export const DAYS_TO_MS : number = 86400000;
    }

    export namespace Bytes
    {
        export const BYTES_TO_KB : number = 1024;
        export const BYTES_TO_MB : number = BYTES_TO_KB * BYTES_TO_KB;
    }

    export namespace Browser
    {
        export const NEW_TAB : string = '_blank';
    }
    
}

export default SysConstants;