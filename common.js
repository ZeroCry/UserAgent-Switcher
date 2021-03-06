/* globals UAParser*/

'use strict';

var ua = {
  userAgent: '',
  appVersion: '',
  platform: '',
  vendor: ''
};

var prefs = {
  ua: '',
  blacklist: [],
  whitelist: [],
  custom: {},
  mode: 'blacklist'
};

chrome.storage.local.get(prefs, ps => {
  Object.assign(prefs, ps);
  update(prefs.mode === 'custom' ? 'Mapped from user\'s JSON object' : prefs.ua);
});
chrome.storage.onChanged.addListener(ps => {
  Object.keys(ps).forEach(key => prefs[key] = ps[key].newValue);
  if (ps.ua) {
    update(prefs.ua);
  }
  if (ps.mode) {
    update(ps.mode.newValue === 'custom' ? 'Mapped from user\'s JSON object' : prefs.ua);
  }
});

function hostname(url) {
  const s = url.indexOf('//') + 2;
  if (s > 1) {
    let o = url.indexOf('/', s);
    if (o > 0) {
      return url.substring(s, o);
    }
    else {
      o = url.indexOf('?', s);
      if (o > 0) {
        return url.substring(s, o);
      }
      else {
        return url.substring(s);
      }
    }
  }
  else {
    return url;
  }
}
function match(url) {
  if (prefs.mode === 'blacklist') {
    if (prefs.blacklist.length) {
      const h = hostname(url);
      return prefs.blacklist.some(s => s === h);
    }
  }
  else if (prefs.mode === 'whitelist') {
    if (prefs.whitelist.length) {
      const h = hostname(url);
      return prefs.whitelist.some(s => s === h) === false;
    }
    else {
      return true;
    }
  }
  else {
    const h = hostname(url);
    return prefs.custom[h];
  }
}

var cache = {};
chrome.tabs.onRemoved.addListener(id => delete cache[id]);

var onBeforeSendHeaders = ({tabId, url, requestHeaders, type}) => {
  if (type === 'main_frame') {
    cache[tabId] = match(url);
  }
  if (cache[tabId] === true) {
    return;
  }
  for (let i = 0, name = requestHeaders[0].name; i < requestHeaders.length; i += 1, name = requestHeaders[i].name) {
    if (name === 'User-Agent' || name === 'user-agent') {
      if (prefs.mode === 'custom') {
        if (cache[tabId]) {
          requestHeaders[i].value = cache[tabId];
        }
        else {
          return;
        }
      }
      else {
        requestHeaders[i].value = ua.userAgent;
      }
      return {
        requestHeaders
      };
    }
  }
};

var onCommitted = ({frameId, url, tabId}) => {
  if (frameId === 0 && url && (url.startsWith('http') || url.startsWith('ftp'))) {
    if (cache[tabId]) {
      return;
    }
    chrome.tabs.executeScript(tabId, {
      runAt: 'document_start',
      allFrames: true,
      code: `{
        const script = document.createElement('script');
        script.textContent = \`{
          navigator.__defineGetter__('userAgent', () => '${ua.userAgent}');
          navigator.__defineGetter__('appVersion', () => '${ua.appVersion}');
          navigator.__defineGetter__('platform', () => '${ua.platform}');
          navigator.__defineGetter__('vendor', () => '${ua.vendor}');
        }\`;
        document.documentElement.appendChild(script);
      }`
    }, () => chrome.runtime.lastError);
  }
};

function update(str) {
  ua.userAgent = str;
  ua.appVersion = str
    .replace(/^Mozilla\//, '')
    .replace(/^Opera\//, '');
  if (str) {
    const p = new UAParser(str);
    ua.platform = p.getOS().name || '';
    ua.vendor = p.getDevice().vendor || '';

    chrome.webRequest.onBeforeSendHeaders.addListener(onBeforeSendHeaders, {
      'urls' : ['*://*/*']
    }, ['blocking', 'requestHeaders']);
    chrome.webNavigation.onCommitted.addListener(onCommitted);
  }
  else {
    chrome.webRequest.onBeforeSendHeaders.removeListener(onBeforeSendHeaders);
    chrome.webNavigation.onCommitted.removeListener(onCommitted);
  }
  chrome.browserAction.setIcon({
    path: {
      16: 'data/icons/' + (str ? 'active/' : '') + '16.png',
      32: 'data/icons/' + (str ? 'active/' : '') + '32.png',
      48: 'data/icons/' + (str ? 'active/' : '') + '48.png',
      64: 'data/icons/' + (str ? 'active/' : '') + '64.png'
    }
  });
  chrome.browserAction.setTitle({
    title: `UserAgent Switcher (${str ? 'enabled' : 'disabled'})

User-Agent String: ${str || navigator.userAgent}`
  });
}

// FAQs & Feedback
chrome.storage.local.get({
  'version': null,
  'faqs': navigator.userAgent.indexOf('Firefox') === -1,
  'last-update': 0,
}, prefs => {
  const version = chrome.runtime.getManifest().version;

  if (prefs.version ? (prefs.faqs && prefs.version !== version) : true) {
    const now = Date.now();
    const doUpdate = (now - prefs['last-update']) / 1000 / 60 / 60 / 24 > 30;
    chrome.storage.local.set({
      version,
      'last-update': doUpdate ? Date.now() : prefs['last-update']
    }, () => {
      // do not display the FAQs page if last-update occurred less than 30 days ago.
      if (doUpdate) {
        const p = Boolean(prefs.version);
        chrome.tabs.create({
          url: chrome.runtime.getManifest().homepage_url + '?version=' + version +
            '&type=' + (p ? ('upgrade&p=' + prefs.version) : 'install'),
          active: p === false
        });
      }
    });
  }
});

{
  const {name, version} = chrome.runtime.getManifest();
  chrome.runtime.setUninstallURL(
    chrome.runtime.getManifest().homepage_url + '?rd=feedback&name=' + name + '&version=' + version
  );
}
