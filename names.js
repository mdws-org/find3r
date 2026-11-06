/* ENS primary names next to wallet addresses.

   A name is the address's primary name (ENSIP-19, through the Universal Resolver in ens.js,
   offchain names included) and is shown only when it resolves forward to the same address,
   so a reverse record cannot claim someone else's name. Lookups use the Ethereum RPC from
   find3r's Settings when one is set, else the public default. Settings can turn the labels
   off ("Show ENS names next to addresses"); off removes the labels and stops the lookups,
   while a name typed into the address box still resolves. This only appends a label;
   find3r's own text and links are untouched. */
(function () {
    var DEFAULT_RPC = 'https://ethereum-rpc.publicnode.com';
    var PREFS_KEY = 'find3r.preferences.v1';

    // The Settings toggle: app.js answers for the live preferences where it is loaded (they may live only in
    // memory on a shared gateway origin); elsewhere the stored preferences; on unless they say names: false.
    function enabled() {
        try {
            if (typeof window.find3rNamesEnabled === 'function') return !!window.find3rNamesEnabled();
            var p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
            return !(p && p.names === false);
        } catch (e) { return true; }
    }
    var FULL = /^0x[0-9a-f]{40}$/i;
    var SHORT = /^(0x[0-9a-f]{4,8})(?:…|\.\.\.)([0-9a-f]{3,6})$/i;
    // Shown names: plain lowercase ASCII labels, at most 64 characters, never address-like.
    var SHOWN = /^[a-z0-9_-]+(\.[a-z0-9-]+)+$/;
    var MAX_LOOKUPS = 40, IN_FLIGHT = 4;
    var cache = new Map(); // address -> Promise<name | null>
    var queue = [], active = 0, started = 0;

    // The Ethereum RPC from Settings; the public default when none is set; null when one is set but this
    // page cannot use it (then no lookup runs, rather than sending addresses to a third party).
    function rpcUrl() {
        var set;
        try {
            var p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
            set = p && p.rpc && p.rpc['1'];
        } catch (e) { /* no stored settings, or storage blocked */ }
        if (set === undefined || set === null || set === '') return DEFAULT_RPC;
        try {
            var url = new URL(String(set));
            if (url.protocol === 'https:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname)) return url.href;
        } catch (e) { /* not a URL */ }
        return null;
    }

    // Parse a JSON body of at most `max` bytes.
    function readJsonCapped(r, max) {
        var reader = r.body && r.body.getReader();
        if (!reader) return r.json();
        var parts = [], n = 0;
        return (function next() {
            return reader.read().then(function (c) {
                if (c.done) return new Blob(parts).text().then(JSON.parse);
                if ((n += c.value.length) > max) { reader.cancel(); throw new Error('reply too large'); }
                parts.push(c.value);
                return next();
            });
        })();
    }

    function ethCall(to, data) {
        var u = rpcUrl();
        if (!u) return Promise.reject(new Error('no usable RPC for name lookups'));
        var opts = {
            method: 'POST', redirect: 'error', credentials: 'omit',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: to, data: data }, 'latest'] }),
        };
        if (AbortSignal.timeout) opts.signal = AbortSignal.timeout(15000);
        return fetch(u, opts).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return readJsonCapped(r, 8000000);
        }).then(function (j) {
            if (j.error) {
                var err = new Error(String(j.error.message || 'eth_call failed'));
                var raw = typeof j.error.data === 'string' ? j.error.data : JSON.stringify(j.error);
                var m = /^0x[0-9a-f]*$/i.test(raw) ? [raw] : /0x556f1830[0-9a-f]*/i.exec(raw) || /0x[0-9a-f]{8,}/i.exec(raw);
                if (m) err.data = m[0];
                throw err;
            }
            return j.result;
        });
    }

    var ens = null;
    function resolver() {
        if (!ens) ens = window.makeEnsResolver(ethCall, window.keccak256);
        return ens;
    }

    function lookup(addr) {
        return resolver().reverse(addr).then(function (name) {
            if (!name) return null;
            name = name.toLowerCase();
            if (name.length > 64 || !SHOWN.test(name) || /^0x[0-9a-f]{4,}/.test(name)) return null;
            return resolver().resolve(name).then(function (fwd) {
                return fwd && fwd.toLowerCase() === addr ? name : null;
            });
        }).catch(function () { return null; });
    }

    // Queued lookups wait while the switch is off and resume when it comes back on; a lookup already sent
    // finishes, and its result is kept (never recorded as "no name" because of the switch).
    function pump() {
        while (enabled() && active < IN_FLIGHT && queue.length) {
            var job = queue.shift();
            active++;
            lookup(job.addr).then(job.done, function () { job.done(null); }).then(function () { active--; pump(); });
        }
    }

    // Names remembered across visits (app.js keeps them in its cache database, when allowed on this origin).
    function stored(addr) {
        var c = window.find3rNameCache;
        if (!c) return Promise.resolve(undefined);
        return Promise.resolve().then(function () { return c.get(addr); }).catch(function () { return undefined; });
    }
    function remember(addr, name) {
        var c = window.find3rNameCache;
        if (c) Promise.resolve().then(function () { return c.put(addr, name); }).catch(function () {});
    }

    function nameFor(addr) {
        addr = addr.toLowerCase();
        if (!cache.has(addr)) {
            cache.set(addr, stored(addr).then(function (hit) {
                if (hit !== undefined) return hit;
                if (started >= MAX_LOOKUPS) return null;
                started++;
                return new Promise(function (done) { queue.push({ addr: addr, done: done }); pump(); }).then(function (name) {
                    remember(addr, name);
                    return name;
                });
            }));
        }
        return cache.get(addr);
    }

    function label(el, addr) {
        var existing = el.querySelector(':scope > .f3r-name');
        if (el.dataset.f3rName !== addr) {
            if (existing) existing.remove();
            existing = null;
            el.dataset.f3rName = addr;
        }
        if (existing) return;
        nameFor(addr).then(function (name) {
            // A lookup that started before the switch was turned off must not add its label afterwards.
            if (!name || !enabled() || el.dataset.f3rName !== addr || el.querySelector(':scope > .f3r-name')) return;
            var s = document.createElement('span');
            s.className = 'f3r-name';
            s.textContent = ' · ' + name;
            el.append(s);
        });
    }

    function hashAddress() {
        var m = /[#&]address=(0x[0-9a-f]{40})(?:&|$)/i.exec(location.hash);
        return m ? m[1].toLowerCase() : null;
    }
    function ownText(el) {
        return el.firstChild && el.firstChild.nodeType === 3 ? el.firstChild.textContent.trim() : '';
    }

    function scan() {
        if (!enabled()) {
            document.querySelectorAll('.f3r-name').forEach(function (s) { s.remove(); });
            return;
        }
        pump();
        // Artwork details: owner and artist addresses, never contract addresses.
        document.querySelectorAll('dd').forEach(function (dd) {
            var t = ownText(dd), dt = dd.previousElementSibling;
            if (FULL.test(t) && !(dt && /contract/i.test(dt.textContent))) label(dd, t.toLowerCase());
        });
        // Saved wallets in the sidebar whose label is only their address (app.js marks them).
        document.querySelectorAll('#folders [data-wallet]').forEach(function (el) {
            if (FULL.test(el.dataset.wallet)) label(el, el.dataset.wallet.toLowerCase());
        });
        // Breadcrumb for an opened wallet: shortened address, full one in the URL.
        var full = hashAddress();
        if (!full) return;
        document.querySelectorAll('nav button').forEach(function (b) {
            var m = SHORT.exec(ownText(b));
            if (m && full.indexOf(m[1].toLowerCase()) === 0 && full.slice(-m[2].length) === m[2].toLowerCase()) label(b, full);
        });
    }

    var queued = false;
    function later() {
        if (queued) return;
        queued = true;
        setTimeout(function () { queued = false; scan(); }, 300);
    }
    function start() {
        new MutationObserver(later).observe(document.body, { childList: true, subtree: true, characterData: true });
        addEventListener('hashchange', later);
        // Settings is a dialog; closing it after a save re-applies the toggle even when nothing else re-rendered.
        document.addEventListener('close', later, true);
        // A switch saved in another tab of this origin reaches this page through the storage event.
        addEventListener('storage', function (e) { if (!e.key || e.key === PREFS_KEY) later(); });
        later();
    }
    if (document.body) start(); else addEventListener('DOMContentLoaded', start);
})();
