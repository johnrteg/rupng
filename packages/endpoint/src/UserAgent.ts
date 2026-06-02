

export namespace UserAgent
{
    export enum OS
    {
        MACOS = "macos",
        WINDOWS = "windows",
        LINUX = "linux",
        IOS = "ios",
        ANDROID = "android",
        UNKNOWN = "unknown"
    }

    export enum Browser
    {
        CHROME = "chrome",
        SAFARI = "safari",
        FIREFOX = "firefox",
        EDGE = "edge",
        UNKNOWN = "unknown"
    }

    export enum Device
    {
        DESKTOP = "desktop",
        MOBILE = "mobile",
        TABLET = "tablet",
        UNKNOWN = "unknown"
    }

    export enum BotType
    {
        SEARCH_ENGINE = "search",  // Google, Bing, etc.
        DEVELOPER_TOOL = "devtool", // Curl, Axios, Postman
        SCRAPER = "scraper",     // Semrush, Headless Chrome, etc.
        NOT_A_BOT = "none"
    }

    export interface BotInfo
    {
        type : BotType;
        name : string;
    }

    export interface Info
    {
        os              : UserAgent.OS;
        browser         : UserAgent.Browser;
        device          : UserAgent.Device;
        osVersion       : string;
        browserVersion  : string;
        bot?            : BotInfo;
    }

    ////////////////////////////////////////////////////////////////////////////////
    export function parse(uaString: string | undefined): Info
    {
        // Fallback defaults for missing or empty headers
        let fallback: Info =
        {
            os: UserAgent.OS.UNKNOWN,
            browser: UserAgent.Browser.UNKNOWN,
            device: UserAgent.Device.UNKNOWN,
            osVersion: "0.0.0",
            browserVersion: "0.0.0",
        };

        // Regex dictionaries for quick matching
        const SEARCH_ENGINES : RegExp = /googlebot|bingbot|yandexbot|baiduspider|duckduckbot|slurp|ia_archiver/i;
        const DEV_TOOLS : RegExp = /curl|wget|axios|postman|insomnia|go-http-client|python-requests|node-fetch/i;
        const SCRAPERS : RegExp = /headlesschrome|selenium|playwright|puppeteer|semrushbot|dotbot|ahrefsbot/i;


        if( !uaString || uaString.trim() === "" ) return fallback;

        // 0. bots
        let bot : BotInfo | undefined = undefined;

        let isBot = false;
        let botType = BotType.NOT_A_BOT;
        let botName: string | null = null;

        // 1. Evaluate Bot Signatures
        if (SEARCH_ENGINES.test(uaString))
        {
            bot = { type : BotType.SEARCH_ENGINE, name : uaString.match(SEARCH_ENGINES)?.[0] || "Unknown Search Bot" };

        }
        else if (DEV_TOOLS.test(uaString))
        {
            bot = { type : BotType.DEVELOPER_TOOL, name : uaString.match(DEV_TOOLS)?.[0] || "Unknown Dev Tool" };
        }
        else if (SCRAPERS.test(uaString))
        {
            bot = { type : BotType.SCRAPER, name : uaString.match(SCRAPERS)?.[0] || "Unknown Scraper" };
        }

        // 2. Determine Device Type (Basic mobile/tablet heuristics)
        let device = UserAgent.Device.DESKTOP;
        if (/tablet|ipad|playbook|silk/i.test(uaString)) {
            device = UserAgent.Device.TABLET;
        } else if (/mobile|iphone|ipod|android|blackberry|iemobile/i.test(uaString)) {
            device = UserAgent.Device.MOBILE;
        }

        // 3. Parse Operating System & OS Version
        let os = UserAgent.OS.UNKNOWN;
        let osVersion = "0.0.0";

        if (/Macintosh/i.test(uaString))
        {
            os = UserAgent.OS.MACOS;
            const match = uaString.match(/Mac OS X (\d+[._]\d+[._]\d+)/i);
            osVersion = match ? match[1].replace(/_/g, ".") : "10.0.0";
        } else if (/Windows/i.test(uaString))
        {
            os = UserAgent.OS.WINDOWS;
            const match = uaString.match(/Windows NT (\d+\.\d+)/i);
            osVersion = match ? match[1] : "10.0";
        } else if (/iPhone|iPad|iPod/i.test(uaString))
        {
            os = UserAgent.OS.IOS;
            const match = uaString.match(/OS (\d+[._]\d+(?:[._]\d+)?)/i);
            osVersion = match ? match[1].replace(/_/g, ".") : "0.0.0";
        } else if (/Android/i.test(uaString))
        {
            os = UserAgent.OS.ANDROID;
            const match = uaString.match(/Android (\d+(\.\d+)?)/i);
            osVersion = match ? match[1] : "0.0.0";
        } else if (/Linux/i.test(uaString))
        {
            os = UserAgent.OS.LINUX;
        }

        // 4. Parse Browser Engine & Browser Version
        let browser = UserAgent.Browser.UNKNOWN;
        let browserVersion = "0.0.0";

        // Check Edge first (since it includes Chrome/Safari keywords)
        if (/Edg\/(\d+\.\d+\.\d+\.\d+)/i.test(uaString))
        {
            browser = UserAgent.Browser.EDGE;
            browserVersion = uaString.match(/Edg\/(\d+\.\d+\.\d+\.\d+)/i)?.[1] || "0.0.0";
        } 
        // Check Chrome (includes Safari keyword)
        else if (/Chrome\/(\d+\.\d+\.\d+\.\d+)/i.test(uaString))
        {
            browser = UserAgent.Browser.CHROME;
            browserVersion = uaString.match(/Chrome\/(\d+\.\d+\.\d+\.\d+)/i)?.[1] || "0.0.0";
        } 
        // Check Safari (standalone)
        else if (/Safari/i.test(uaString) && !/Chrome/i.test(uaString))
        {
            browser = UserAgent.Browser.SAFARI;
            browserVersion = uaString.match(/Version\/(\d+\.\d+(\.\d+)?)/i)?.[1] || "0.0.0";
        } 
        // Check Firefox
        else if (/Firefox\/(\d+\.\d+)/i.test(uaString))
        {
            browser = UserAgent.Browser.FIREFOX;
            browserVersion = uaString.match(/Firefox\/(\d+\.\d+)/i)?.[1] || "0.0.0";
        }

        return { os: os, browser : browser, device : device, osVersion : osVersion, browserVersion: browserVersion, bot : bot };
    }
}


export default UserAgent;
