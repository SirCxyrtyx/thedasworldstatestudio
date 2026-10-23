// Exercise the actual browser lifecycle handlers with no real browser state.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'gui/app.js'), 'utf8');
const handlers = new Map(), requests = [], timers = [];
let dirty = true;
const context = vm.createContext({
  document: {}, URLSearchParams, AbortController,
  location: {hash: '#session=test-secret', pathname: '/'},
  sessionStorage: {setItem() {}}, history: {replaceState() {}},
  crypto: {randomUUID: () => 'document-one'},
  window: {addEventListener: (event, handler) => handlers.set(event, handler)},
  dirty: () => dirty, state: {touched: true},
  setTimeout: fn => timers.push(fn),
  fetch: async (url, options) => {
    requests.push({url, ...options});
    if (url.startsWith('/api/window-stream')) return {ok: true, body: {getReader: () => ({
      read: () => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('closed')));
      })
    })}};
    return {ok: true};
  }
});
vm.runInContext(source.split('const state =')[0], context);
vm.runInContext(source.match(/^window.addEventListener\('beforeunload'.*$/m)[0], context);

// If session storage is blocked, the launcher fragment must survive a reload.
function sessionBoot(hash, stored = null, blocked = false) {
  const location = {hash, pathname: '/'};
  const boot = vm.createContext({URLSearchParams, location, document: {},
    sessionStorage: {
      setItem(_key, value) { if (blocked) throw Error('Storage blocked'); stored = value; },
      getItem() { if (blocked) throw Error('Storage blocked'); return stored; }
    }, history: {replaceState() { location.hash = ''; }}});
  vm.runInContext(source.slice(0, source.indexOf('// Each document')), boot);
  return {token: vm.runInContext('token', boot), hash: location.hash, stored};
}
const storedSession = sessionBoot('#session=reload-test');
assert.equal(storedSession.hash, '');
assert.equal(sessionBoot('', storedSession.stored).token, 'reload-test');
const fallbackSession = sessionBoot('#session=reload-test', null, true);
assert.equal(fallbackSession.hash, '#session=reload-test', 'blocked storage must retain the reload fallback');
assert.equal(sessionBoot(fallbackSession.hash, null, true).token, 'reload-test');
assert.equal(sessionBoot('', null, true).token, null, 'a missing session still requires the launcher');

(async () => {
  await vm.runInContext('openWindow()', context);
  assert.equal(JSON.parse(requests[0].body).event, 'open');
  assert.equal(requests[0].keepalive, true);
  assert.equal(requests[1].headers.Authorization, 'Bearer test-secret');
  assert.ok(!requests[1].url.includes('test-secret'));
  let prevented = false;
  const event = {preventDefault: () => { prevented = true; }};
  handlers.get('beforeunload')(event);
  assert.equal(prevented, true);
  assert.equal(requests.length, 2, 'canceling close must leave the connection open');
  dirty = false;
  handlers.get('beforeunload')({preventDefault: () => assert.fail('clean page was blocked')});
  assert.equal(requests.length, 2);
  handlers.get('pagehide')();
  assert.equal(requests[1].signal.aborted, true);
  const close = requests[2];
  assert.equal(close.keepalive, true);
  assert.equal(JSON.parse(close.body).event, 'close');
  assert.equal(JSON.parse(close.body).sequence, 2);
  handlers.get('pageshow')({persisted: true});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(JSON.parse(requests[3].body).event, 'open');
  assert.equal(JSON.parse(requests[3].body).sequence, 3);
  assert.equal(requests[4].signal.aborted, false);
  handlers.get('pagehide')();
  console.log('PASS: authenticated stream, canceled close, accepted close, restored page and sequence ordering');
})().catch(error => { console.error(error); process.exitCode = 1; });
