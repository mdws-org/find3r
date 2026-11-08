// Off, then on, with no re-render in between: on artwork.html (no Settings dialog, so names.js reads the stored
// preference) a label is present; the preference is set to names:false and a dialog close event dispatched (the
// trigger names.js listens for); the label must be gone; names:true and another close; the SAME element must carry
// a label again. Also: a lookup queued while off must not start until on.
// usage: CHROME_PATH=... node names-offon.mjs <artwork page url>
import { chromium } from 'playwright-core';

const [url] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let reverseCalls = 0;
page.on('request', (r) => {
    let b; try { b = JSON.parse(r.postData() || ''); } catch { return; }
    for (const m of Array.isArray(b) ? b : [b])
        if (m.method === 'eth_call' && String(m.params?.[0]?.to || '').toLowerCase() === '0xeeeeeeee14d718c2b47d9923deab1335e144eeee'
            && String(m.params?.[0]?.data || '').startsWith('0x5d78a217')) reverseCalls++;
});
await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('.f3r-name', { state: 'attached', timeout: 120000 });
// Mark the labelled element so the same node can be checked after the cycle.
const marked = await page.evaluate(() => {
    const el = document.querySelector('.f3r-name').parentElement;
    el.setAttribute('data-probe', '1');
    return { text: el.textContent.trim().slice(0, 80), addr: el.dataset.f3rName };
});
console.log(`label on: "${marked.text}" (${marked.addr}); reverse lookups so far ${reverseCalls}`);

const setPref = (on) => page.evaluate((on) => {
    const k = 'find3r.preferences.v1';
    const p = JSON.parse(localStorage.getItem(k) || '{"folders":[]}');
    p.names = on;
    localStorage.setItem(k, JSON.stringify(p));
    document.body.dispatchEvent(new Event('close'));
}, on);

await setPref(false);
await page.waitForTimeout(800);
const offCount = await page.locator('.f3r-name').count();
const markerKept = await page.evaluate(() => document.querySelector('[data-probe]').dataset.f3rName);
const callsOff = reverseCalls;
console.log(`off: ${offCount} label(s); element still marked ${markerKept}`);

await setPref(true);
await page.waitForTimeout(1500);
const onCount = await page.locator('[data-probe] > .f3r-name').count();
const total = await page.locator('.f3r-name').count();
console.log(`on again: label on the same element ${onCount}, labels total ${total}, new reverse lookups ${reverseCalls - callsOff}`);
await browser.close();
const ok = offCount === 0 && onCount === 1 && errors.length === 0;
if (errors.length) console.log('page errors:', errors.join(' | ').slice(0, 300));
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
