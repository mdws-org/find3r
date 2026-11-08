// Load every find3r page under the headers a host would send and report content-security-policy violations,
// page errors and the headers actually received. Pages: the wallet view, an artwork and its live view, an app
// opened in the viewer (a popup), the gateway helper, learn and changes.
// usage: CHROME_PATH=... node csp-check.mjs <base url served with _headers>
import { chromium } from 'playwright-core';

const [base] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} blocked ${e.blockedURI || '(inline)'} in ${e.documentURI.replace(/^https?:\/\/[^/]+/, '')}${e.sourceFile ? ` from ${e.sourceFile.replace(/^https?:\/\/[^/]+/, '')}:${e.lineNumber}` : ''}`));
});
let bad = 0;
async function check(label, page, work) {
    const errors = [], console_ = [], docHeaders = {};
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') console_.push(m.text().slice(0, 160)); });
    page.on('response', (r) => { if (r.request().resourceType() === 'document' && r.url().startsWith(base)) docHeaders[r.url().replace(base, '/')] = r.headers(); });
    try { await work(page); } catch (e) { errors.push('test: ' + e.message.split('\n')[0]); }
    const csp = await page.evaluate(() => window.__csp).catch(() => ['(could not read)']);
    const frames = page.frames().length - 1;
    const hdr = Object.entries(docHeaders).map(([p, h]) => `${p}: csp=${h['content-security-policy'] ? 'yes' : 'no'} cache=${h['cache-control'] || '-'} xfo=${h['x-frame-options'] || '-'} nosniff=${h['x-content-type-options'] || '-'}`).join('; ');
    // A stylesheet or script the browser refused (wrong type, usually a rewrite answering with a page) fails too.
    const refused = console_.filter((x) => /Refused to (apply style|execute script)/.test(x));
    const ok = csp.length === 0 && errors.length === 0 && refused.length === 0;
    bad += !ok;
    console.log(`${ok ? 'ok ' : 'ERR'} ${label}: ${csp.length} CSP violation(s), ${errors.length} page error(s), ${frames} child frame(s); ${hdr}`);
    for (const v of csp) console.log('     CSP ' + v);
    for (const e of errors) console.log('     ERR ' + e);
    for (const c of console_.filter((x) => /Content Security Policy|Refused to/.test(x))) console.log('     CON ' + c);
}
const settled = () => !/Loading your folder|Looking inside|Finding this address|Checking|Opening|Reading/.test(document.body.innerText);

// 1. wallet view
{
    const page = await context.newPage();
    await check('wallet (thebenmeadows.eth)', page, async (p) => {
        await p.goto(base, { waitUntil: 'load' });
        await p.fill('#address', 'thebenmeadows.eth');
        await p.press('#address', 'Enter');
        await p.waitForFunction(settled, null, { timeout: 180000 }).catch(() => {});
        await p.waitForSelector('.f3r-name', { state: 'attached', timeout: 60000 }).catch(() => {});
        await p.waitForTimeout(1500);
    });
    await page.close();
}
// 2. artwork page and its live view
for (const view of ['', '&view=live']) {
    const page = await context.newPage();
    await check(`artwork hollerith #0${view ? ' live view' : ''}`, page, async (p) => {
        await p.goto(`${base}artwork.html?chain=1&contract=0x50c54a89186a855e68a9d7ca2afe0803a532e1f3&token=0&adapter=abx${view}`, { waitUntil: 'load' });
        await p.waitForTimeout(view ? 12000 : 8000);
    });
    await page.close();
}
// 3. an app in the viewer: QRT.codes, the example publication from upstream's AGENTS.md
{
    const page = await context.newPage();
    await check('viewer (QRT.codes app)', page, async (p) => {
        await p.goto(base, { waitUntil: 'load' });
        const popup = p.context().waitForEvent('page', { timeout: 120000 });
        await p.fill('#address', 'web3://0x10ddfcbcd62e784c522d0b466ed109fc65b2a855:8453/6/v/2/');
        await p.press('#address', 'Enter');
        // The viewer opens in a popup or in this tab, and once the app is open it rewrites its address to the
        // public /app/ route, so it is recognised by its frame, not its URL.
        let viewer;
        try { viewer = await popup; } catch { viewer = null; }
        if (!viewer) {
            await p.waitForFunction(() => document.querySelector('iframe.viewer-frame') || /viewer\.html|\/app\//.test(location.href), null, { timeout: 60000 }).catch(() => {});
            viewer = p;
        }
        await viewer.waitForLoadState('load').catch(() => {});
        await viewer.waitForFunction(() => document.querySelector('iframe.viewer-frame'), null, { timeout: 120000 }).catch(() => {});
        await viewer.waitForTimeout(8000);
        const vcsp = await viewer.evaluate(() => window.__csp).catch(() => []);
        const frameCount = viewer.frames().length - 1;
        const status = await viewer.evaluate(() => document.querySelector('#viewer-status')?.textContent || '').catch(() => '');
        const where = viewer.url().replace(base, '/');
        console.log(`     viewer page: ${frameCount} child frame(s), status "${status.trim().slice(0, 80)}", address ${where.slice(0, 90)}, ${vcsp.length} CSP violation(s)`);
        for (const v of vcsp) console.log('     CSP ' + v);
        if (vcsp.length) throw new Error('viewer CSP violations');
        if (!/App opened/.test(status)) throw new Error(`viewer status: "${status.trim().slice(0, 80)}"`);
        // The reload case: the public route must serve the viewer again.
        await viewer.goto(viewer.url(), { waitUntil: 'load' });
        await viewer.waitForFunction(() => document.querySelector('iframe.viewer-frame'), null, { timeout: 120000 }).catch(() => {});
        await viewer.waitForTimeout(5000);
        const status2 = await viewer.evaluate(() => document.querySelector('#viewer-status')?.textContent || '').catch(() => '');
        console.log(`     viewer reload at ${viewer.url().replace(base, '/').slice(0, 90)}: status "${status2.trim().slice(0, 80)}"`);
        if (!/App opened/.test(status2)) throw new Error(`viewer reload status: "${status2.trim().slice(0, 80)}"`);
        if (viewer !== p) await viewer.close();
    });
    await page.close();
}
// 4. the static pages
for (const path of ['gateway.html', 'learn.html', 'changes.html']) {
    const page = await context.newPage();
    await check(path, page, async (p) => { await p.goto(base + path, { waitUntil: 'load' }); await p.waitForTimeout(1500); });
    await page.close();
}
await browser.close();
console.log(bad ? 'FAIL' : 'PASS');
process.exit(bad ? 1 : 0);
