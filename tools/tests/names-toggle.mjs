// The "Show ENS names next to addresses" toggle in Settings.
// Open a wallet, expect name labels; turn the toggle off through the Settings dialog, expect the labels
// gone and no further reverse lookups; turn it back on, expect labels again.
// usage: CHROME_PATH=... node names-toggle.mjs <base url> <wallet address or ENS name>
import { chromium } from 'playwright-core';

const [base, wallet] = process.argv.slice(2);
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

await page.goto(base, { waitUntil: 'load' });
await page.fill('#address', wallet);
await page.press('#address', 'Enter');
await page.waitForSelector('.f3r-name', { timeout: 120000 });
const labels1 = await page.locator('.f3r-name').count();
const calls1 = reverseCalls;
console.log(`labels on: ${labels1} label(s), ${calls1} reverse lookup(s)`);

async function setToggle(on) {
    await page.click('#settings');
    await page.waitForSelector('#settings-dialog[open]');
    await page.setChecked('#app-names', on);
    await page.click('#settings-dialog button.primary[type=submit]');
    await page.waitForFunction(() => !document.querySelector('#settings-dialog').open);
    await page.waitForTimeout(1200);
}
await setToggle(false);
const pref = await page.evaluate(() => JSON.parse(localStorage.getItem('find3r.preferences.v1') || '{}').names);
const labels2 = await page.locator('.f3r-name').count();
const callsAtOff = reverseCalls;
// Navigate within the wallet so new addresses render while the toggle is off.
await page.evaluate(() => location.hash = location.hash.replace(/&?view=[^&]*/, ''));
await page.waitForTimeout(2500);
const labels3 = await page.locator('.f3r-name').count();
const callsAfterOff = reverseCalls;
console.log(`labels off: stored names=${pref}, ${labels2} label(s) right after save, ${labels3} after re-render, ${callsAfterOff - callsAtOff} new reverse lookup(s)`);

await setToggle(true);
await page.waitForSelector('.f3r-name', { timeout: 60000 }).catch(() => {});
const labels4 = await page.locator('.f3r-name').count();
const pref2 = await page.evaluate(() => JSON.parse(localStorage.getItem('find3r.preferences.v1') || '{}').names);
console.log(`labels on again: stored names=${pref2}, ${labels4} label(s)`);
await browser.close();

const ok = labels1 > 0 && pref === false && labels2 === 0 && labels3 === 0 && callsAfterOff === callsAtOff && pref2 === true && labels4 > 0 && errors.length === 0;
if (errors.length) console.log('page errors:', errors.join(' | ').slice(0, 300));
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
