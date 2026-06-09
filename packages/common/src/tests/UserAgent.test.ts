//
import UserAgent from '../utils/UserAgent';

describe('UserAgent.parse', () => {

  // Representative real-world UA strings.
  const UA = {
    chromeWin:  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.109 Safari/537.36',
    chromeMac:  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    safariMac:  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    edgeWin:    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.2210.91',
    firefoxLin: 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
    safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
    safariIpad: 'Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
    chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    googlebot:  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    curl:       'curl/8.4.0',
    puppeteer:  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36',
  };

  describe('fallback handling', () => {
    it('returns all-unknown for undefined input', () =>
    {
      expect(UserAgent.parse(undefined)).toEqual({
        os: UserAgent.OS.UNKNOWN,
        browser: UserAgent.Browser.UNKNOWN,
        device: UserAgent.Device.UNKNOWN,
        osVersion: '0.0.0',
        browserVersion: '0.0.0',
      });
    });

    it('returns all-unknown for an empty / whitespace string', () =>
    {
      expect(UserAgent.parse('   ').device).toBe(UserAgent.Device.UNKNOWN);
    });

    it('does not attach a bot for the fallback', () =>
    {
      expect(UserAgent.parse('').bot).toBeUndefined();
    });
  });

  describe('operating system', () => {
    it('detects Windows and its NT version', () =>
    {
      const info = UserAgent.parse(UA.chromeWin);
      expect(info.os).toBe(UserAgent.OS.WINDOWS);
      expect(info.osVersion).toBe('10.0');
    });

    it('detects macOS and normalises underscores in the version', () =>
    {
      const info = UserAgent.parse(UA.safariMac);
      expect(info.os).toBe(UserAgent.OS.MACOS);
      expect(info.osVersion).toBe('10.15.7');
    });

    it('detects iOS on iPhone before falling through to macOS', () =>
    {
      const info = UserAgent.parse(UA.safariIphone);
      expect(info.os).toBe(UserAgent.OS.IOS);
      expect(info.osVersion).toBe('17.1');
    });

    it('detects iOS on iPad even though the UA mentions "Mac OS X"', () =>
    {
      const info = UserAgent.parse(UA.safariIpad);
      expect(info.os).toBe(UserAgent.OS.IOS);
    });

    it('detects Android before Linux and reads its version', () =>
    {
      const info = UserAgent.parse(UA.chromeAndroid);
      expect(info.os).toBe(UserAgent.OS.ANDROID);
      expect(info.osVersion).toBe('14');
    });

    it('detects Linux', () =>
    {
      expect(UserAgent.parse(UA.firefoxLin).os).toBe(UserAgent.OS.LINUX);
    });
  });

  describe('device', () => {
    it('classifies a desktop UA as DESKTOP', () =>
    {
      expect(UserAgent.parse(UA.chromeWin).device).toBe(UserAgent.Device.DESKTOP);
    });

    it('classifies an iPhone as MOBILE', () =>
    {
      expect(UserAgent.parse(UA.safariIphone).device).toBe(UserAgent.Device.MOBILE);
    });

    it('classifies an iPad as TABLET', () =>
    {
      expect(UserAgent.parse(UA.safariIpad).device).toBe(UserAgent.Device.TABLET);
    });
  });

  describe('browser', () => {
    it('detects Chrome and version', () =>
    {
      const info = UserAgent.parse(UA.chromeWin);
      expect(info.browser).toBe(UserAgent.Browser.CHROME);
      expect(info.browserVersion).toBe('120.0.6099.109');
    });

    it('detects Edge before Chrome (Edge UA contains a Chrome token)', () =>
    {
      const info = UserAgent.parse(UA.edgeWin);
      expect(info.browser).toBe(UserAgent.Browser.EDGE);
      expect(info.browserVersion).toBe('120.0.2210.91');
    });

    it('detects Safari and uses the Version/ token', () =>
    {
      const info = UserAgent.parse(UA.safariMac);
      expect(info.browser).toBe(UserAgent.Browser.SAFARI);
      expect(info.browserVersion).toBe('17.1');
    });

    it('does not classify Chrome as Safari', () =>
    {
      expect(UserAgent.parse(UA.chromeMac).browser).toBe(UserAgent.Browser.CHROME);
    });

    it('detects Firefox and version', () =>
    {
      const info = UserAgent.parse(UA.firefoxLin);
      expect(info.browser).toBe(UserAgent.Browser.FIREFOX);
      expect(info.browserVersion).toBe('121.0');
    });
  });

  describe('bots', () => {
    it('identifies a search-engine bot', () =>
    {
      expect(UserAgent.parse(UA.googlebot).bot).toEqual({
        type: UserAgent.BotType.SEARCH_ENGINE,
        name: 'Googlebot',
      });
    });

    it('identifies a developer tool', () =>
    {
      const bot = UserAgent.parse(UA.curl).bot;
      expect(bot?.type).toBe(UserAgent.BotType.DEVELOPER_TOOL);
      expect(bot?.name.toLowerCase()).toBe('curl');
    });

    it('identifies a scraper / headless browser', () =>
    {
      const bot = UserAgent.parse(UA.puppeteer).bot;
      expect(bot?.type).toBe(UserAgent.BotType.SCRAPER);
      expect(bot?.name.toLowerCase()).toBe('headlesschrome');
    });

    it('leaves bot undefined for an ordinary browser', () =>
    {
      expect(UserAgent.parse(UA.chromeWin).bot).toBeUndefined();
    });
  });
});
