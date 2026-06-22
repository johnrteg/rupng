

//
// Compiled once at module load rather than on every parse() call.
//
const SEARCH_ENGINES : RegExp = /googlebot|bingbot|yandexbot|baiduspider|duckduckbot|slurp|ia_archiver/i;
const DEV_TOOLS      : RegExp = /curl|wget|axios|postman|insomnia|go-http-client|python-requests|node-fetch/i;
const SCRAPERS       : RegExp = /headlesschrome|selenium|playwright|puppeteer|semrushbot|dotbot|ahrefsbot/i;

const TABLET_RE : RegExp = /tablet|ipad|playbook|silk/i;
const MOBILE_RE : RegExp = /mobile|iphone|ipod|android|blackberry|iemobile/i;

const IOS_DEVICE_RE : RegExp = /iPhone|iPad|iPod/i;
const MAC_RE        : RegExp = /Macintosh/i;
const WINDOWS_RE    : RegExp = /Windows/i;
const ANDROID_RE    : RegExp = /Android/i;
const LINUX_RE      : RegExp = /Linux/i;

const MAC_VERSION_RE     : RegExp = /Mac OS X (\d+[._]\d+[._]\d+)/i;
const WINDOWS_VERSION_RE : RegExp = /Windows NT (\d+\.\d+)/i;
const IOS_VERSION_RE     : RegExp = /OS (\d+[._]\d+(?:[._]\d+)?)/i;
const ANDROID_VERSION_RE : RegExp = /Android (\d+(\.\d+)?)/i;

const EDGE_RE          : RegExp = /Edg\/(\d+\.\d+\.\d+\.\d+)/i;
const CHROME_RE        : RegExp = /Chrome\/(\d+\.\d+\.\d+\.\d+)/i;
const SAFARI_RE        : RegExp = /Safari/i;
const SAFARI_VERSION_RE: RegExp = /Version\/(\d+\.\d+(\.\d+)?)/i;
const FIREFOX_RE       : RegExp = /Firefox\/(\d+\.\d+)/i;


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
        const fallback: Info =
        {
            os: UserAgent.OS.UNKNOWN,
            browser: UserAgent.Browser.UNKNOWN,
            device: UserAgent.Device.UNKNOWN,
            osVersion: "0.0.0",
            browserVersion: "0.0.0",
        };

        if( !uaString || uaString.trim() === "" ) return fallback;

        // 1. Evaluate bot signatures (match once, reuse the capture)
        let bot : BotInfo | undefined = undefined;

        const searchMatch = uaString.match(SEARCH_ENGINES);
        const devMatch    = uaString.match(DEV_TOOLS);
        const scraperMatch = uaString.match(SCRAPERS);

        if (searchMatch)
        {
            bot = { type : BotType.SEARCH_ENGINE, name : searchMatch[0] };
        }
        else if (devMatch)
        {
            bot = { type : BotType.DEVELOPER_TOOL, name : devMatch[0] };
        }
        else if (scraperMatch)
        {
            bot = { type : BotType.SCRAPER, name : scraperMatch[0] };
        }

        // 2. Determine device type (basic mobile/tablet heuristics)
        let device = UserAgent.Device.DESKTOP;
        if (TABLET_RE.test(uaString)) {
            device = UserAgent.Device.TABLET;
        } else if (MOBILE_RE.test(uaString)) {
            device = UserAgent.Device.MOBILE;
        }

        // 3. Parse operating system & OS version.
        // iOS devices are checked before Macintosh because they're unambiguous. Note: iPadOS in
        // desktop mode reports "Macintosh" with no iPad token, so those iPads fall through to MACOS.
        let os = UserAgent.OS.UNKNOWN;
        let osVersion = "0.0.0";

        if (IOS_DEVICE_RE.test(uaString))
        {
            os = UserAgent.OS.IOS;
            const match = uaString.match(IOS_VERSION_RE);
            osVersion = match ? match[1].replace(/_/g, ".") : "0.0.0";
        } else if (MAC_RE.test(uaString))
        {
            os = UserAgent.OS.MACOS;
            const match = uaString.match(MAC_VERSION_RE);
            osVersion = match ? match[1].replace(/_/g, ".") : "10.0.0";
        } else if (WINDOWS_RE.test(uaString))
        {
            os = UserAgent.OS.WINDOWS;
            const match = uaString.match(WINDOWS_VERSION_RE);
            osVersion = match ? match[1] : "10.0";
        } else if (ANDROID_RE.test(uaString))
        {
            os = UserAgent.OS.ANDROID;
            const match = uaString.match(ANDROID_VERSION_RE);
            osVersion = match ? match[1] : "0.0.0";
        } else if (LINUX_RE.test(uaString))
        {
            os = UserAgent.OS.LINUX;
        }

        // 4. Parse browser & browser version (match once per candidate).
        let browser = UserAgent.Browser.UNKNOWN;
        let browserVersion = "0.0.0";

        const edgeMatch    = uaString.match(EDGE_RE);
        const chromeMatch  = uaString.match(CHROME_RE);
        const firefoxMatch = uaString.match(FIREFOX_RE);

        // Check Edge first (its UA also includes Chrome/Safari tokens), then Chrome (includes Safari).
        if (edgeMatch)
        {
            browser = UserAgent.Browser.EDGE;
            browserVersion = edgeMatch[1];
        }
        else if (chromeMatch)
        {
            browser = UserAgent.Browser.CHROME;
            browserVersion = chromeMatch[1];
        }
        else if (SAFARI_RE.test(uaString) && !CHROME_RE.test(uaString))
        {
            browser = UserAgent.Browser.SAFARI;
            browserVersion = uaString.match(SAFARI_VERSION_RE)?.[1] || "0.0.0";
        }
        else if (firefoxMatch)
        {
            browser = UserAgent.Browser.FIREFOX;
            browserVersion = firefoxMatch[1];
        }

        return { os: os, browser : browser, device : device, osVersion : osVersion, browserVersion: browserVersion, bot : bot };
    }
}


export default UserAgent;
