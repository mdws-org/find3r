// The cost of a clean second pass over cached collection classes: open each contract twice in one browser
// context (nothing flipped between passes) and count Multicall3 aggregate3 calls and single supportsInterface /
// abxVersion calls per pass. The second pass should show one aggregate3 per chain for the check and no single probes.
// usage: CHROME_PATH=... node class-clean.mjs <base url> <contract address>...
import { chromium } from 'playwright-core';

const [base, ...contracts] = process.argv.slice(2);
const MULTICALL = '0xca11bde05977b3631167028862be2a173976ca11';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
function counter(page) {
    const n = { aggregate3: 0, supportsInterface: 0, otherInterface: [], abxVersion: 0, name: 0 };
    page.on('request', (r) => {
        let b; try { b = JSON.parse(r.postData() || ''); } catch { return; }
        for (const m of Array.isArray(b) ? b : [b]) {
            if (m.method !== 'eth_call') continue;
            const to = String(m.params?.[0]?.to || '').toLowerCase(), data = String(m.params?.[0]?.data || '');
            if (to === MULTICALL && data.startsWith('0x82ad56cb')) n.aggregate3++;
            else if (data.startsWith('0x01ffc9a7')) {
                // Only the two class probes count; other interface ids belong to later views.
                const id = data.slice(10, 18);
                if (id === '80ac58cd' || id === 'd9b67a26') n.supportsInterface++; else n.otherInterface.push(id);
            }
            else if (data.startsWith('0x4aa3adb3')) n.abxVersion++;
            else if (data.startsWith('0x06fdde03')) n.name++;
        }
    });
    return n;
}
const settled = () => !/Loading your folder|Looking inside|Finding this address|Checking|Opening/.test(document.body.innerText);
async function pass(label) {
    const page = await context.newPage();
    const n = counter(page);
    const t0 = Date.now();
    for (const c of contracts) {
        await page.goto(base, { waitUntil: 'load' });
        await page.fill('#address', c);
        await page.press('#address', 'Enter');
        await page.waitForTimeout(800);
        const choice = page.locator('#network-dialog[open] #network-choices button').first();
        if (await choice.count()) await choice.click();
        await page.waitForFunction(settled, null, { timeout: 180000 }).catch(() => {});
        await page.waitForTimeout(1000);
    }
    console.log(`${label}: ${((Date.now() - t0) / 1000).toFixed(1)} s; aggregate3 ${n.aggregate3}, class supportsInterface ${n.supportsInterface}, abxVersion ${n.abxVersion}, name ${n.name}, other interface ids ${n.otherInterface.join(' ') || 'none'}`);
    await page.close();
    return n;
}
const a = await pass('first pass (cache fill)');
const b = await pass('second pass (cached, verified)');
await browser.close();
const ok = b.supportsInterface === 0 && b.aggregate3 >= 1;
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
