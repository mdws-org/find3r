// The artwork page's use of the shared class cache.
// 1. On index.html, open the contract through the address box so app.js caches its class.
// 2. Flip the cached class in IndexedDB.
// 3. Open the artwork page for one token: it must run the Multicall3 check, forget the flipped entry, and still
//    show the artwork (owner read through the right interface, no error text).
// 4. Re-cache from index.html and open the artwork page again: one Multicall3 call, no single class probes.
// usage: CHROME_PATH=... node artwork-check.mjs <base url> <chain> <contract> <token>
import { chromium } from 'playwright-core';

const [base, chain, contract, token] = process.argv.slice(2);
const MULTICALL = '0xca11bde05977b3631167028862be2a173976ca11';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
function counter(page) {
    const n = { aggregate3: 0, classProbes: 0 };
    page.on('request', (r) => {
        let b; try { b = JSON.parse(r.postData() || ''); } catch { return; }
        for (const m of Array.isArray(b) ? b : [b]) {
            if (m.method !== 'eth_call') continue;
            const to = String(m.params?.[0]?.to || '').toLowerCase(), data = String(m.params?.[0]?.data || '');
            if (to === MULTICALL && data.startsWith('0x82ad56cb')) n.aggregate3++;
            else if (to === contract.toLowerCase() && (data.startsWith('0x01ffc9a7') || data.startsWith('0x4aa3adb3'))) n.classProbes++;
        }
    });
    return n;
}
const settled = () => !/Loading your folder|Looking inside|Finding this address|Checking|Opening|Reading/.test(document.body.innerText);
const readClasses = () => new Promise((done) => {
    const req = indexedDB.open('find3r.cache.v1', 2);
    req.onsuccess = () => {
        const db = req.result, out = [];
        const cur = db.transaction('classes', 'readonly').objectStore('classes').openCursor();
        cur.onsuccess = () => { const c = cur.result; if (!c) { db.close(); return done(out); } out.push(c.value); c.continue(); };
        cur.onerror = () => { db.close(); done(out); };
    };
    req.onerror = () => done([]);
});
const flipClasses = () => new Promise((done) => {
    const req = indexedDB.open('find3r.cache.v1', 2);
    req.onsuccess = () => {
        const db = req.result, tx = db.transaction('classes', 'readwrite'), s = tx.objectStore('classes');
        let n = 0;
        const cur = s.openCursor();
        cur.onsuccess = () => {
            const c = cur.result; if (!c) return;
            const v = c.value;
            v.standard = v.standard === 'erc721' ? 'erc1155' : 'erc721';
            v.abxVersion = (v.abxVersion || 0) + 1;
            c.update(v); n++; c.continue();
        };
        tx.oncomplete = () => { db.close(); done(n); };
        tx.onerror = tx.onabort = () => { db.close(); done(-1); };
    };
    req.onerror = () => done(-1);
});
async function cacheFromIndex() {
    const page = await context.newPage();
    await page.goto(base, { waitUntil: 'load' });
    await page.fill('#address', contract);
    await page.press('#address', 'Enter');
    await page.waitForTimeout(800);
    const choice = page.locator('#network-dialog[open] #network-choices button').first();
    if (await choice.count()) await choice.click();
    await page.waitForFunction(settled, null, { timeout: 180000 }).catch(() => {});
    await page.waitForTimeout(1000);
    const rows = await page.evaluate(readClasses);
    await page.close();
    return rows;
}
async function openArtwork(label) {
    const page = await context.newPage();
    const n = counter(page);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base}artwork.html?chain=${chain}&contract=${contract}&token=${token}&adapter=auto`, { waitUntil: 'load' });
    await page.waitForFunction(() => /Owner|owner/.test(document.body.innerText) || /could not|not currently|does not expose|error/i.test(document.body.innerText), null, { timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(1500);
    // textContent, not innerText: the details panel that carries the owner can be collapsed.
    const text = (await page.evaluate(() => document.body.textContent)).replace(/\s+/g, ' ');
    // The owner is the one full address on the page that is not the contract.
    const owner = (text.match(/0x[0-9a-fA-F]{40}/g) || []).find((x) => x.toLowerCase() !== contract.toLowerCase()) || null;
    const err = text.match(/(does not expose a supported NFT interface|could not be read|not currently minted)[^.]*/i)?.[0] || null;
    const rows = await page.evaluate(readClasses);
    console.log(`${label}: aggregate3 ${n.aggregate3}, class probes ${n.classProbes}, owner ${owner ? 'shown' : 'missing'}${err ? `, error: ${err}` : ''}${errors.length ? `, page errors: ${errors.join(' | ').slice(0, 120)}` : ''}; cached rows ${rows.map((r) => `${r.key} ${r.standard} abx${r.abxVersion || 0}`).join('; ') || 'none'}`);
    await page.close();
    return { n, owner, err, rows, errors };
}

const cached = await cacheFromIndex();
console.log(`cached from index: ${cached.map((r) => `${r.key} ${r.standard} abx${r.abxVersion || 0}`).join('; ') || 'none'}`);
if (!cached.length) { console.log('ERR nothing cached'); await browser.close(); process.exit(2); }
const good = cached[0];
const flipped = await (async () => { const p = await context.newPage(); await p.goto(base, { waitUntil: 'load' }); const n = await p.evaluate(flipClasses); await p.close(); return n; })();
console.log(`flipped ${flipped}`);
const a = await openArtwork('artwork with a flipped cache');
const flippedGone = !a.rows.some((r) => r.key === good.key && (r.standard !== good.standard || (r.abxVersion || 0) !== (good.abxVersion || 0)));
await cacheFromIndex();
const b = await openArtwork('artwork with a good cache');
await browser.close();
const ok = a.n.aggregate3 >= 1 && flippedGone && a.owner && !a.err && a.errors.length === 0
    && b.n.aggregate3 >= 1 && b.n.classProbes === 0 && b.owner && !b.err && b.errors.length === 0;
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
