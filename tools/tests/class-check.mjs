// Check-on-read for cached collection classes.
// 1. Open each contract through the address box so its class lands in the cross-visit cache.
// 2. Flip every cached class (erc721 <-> erc1155, abxVersion + 1) in IndexedDB.
// 3. Open the same contracts again and read the cache back: every flipped entry must be gone or restored
//    to the live class, and each collection view must read the same as on the first pass.
// 4. Count Multicall3 aggregate3 calls and single supportsInterface / abxVersion calls on both passes.
// Against the old build the flipped entries survive and the views change, which is what the check is for.
// usage: CHROME_PATH=... node class-check.mjs <base url> <contract address>...
import { chromium } from 'playwright-core';

const [base, ...contracts] = process.argv.slice(2);
const MULTICALL = '0xca11bde05977b3631167028862be2a173976ca11';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

function counter(page) {
    const n = { aggregate3: 0, supportsInterface: 0, abxVersion: 0 };
    page.on('request', (r) => {
        let b; try { b = JSON.parse(r.postData() || ''); } catch { return; }
        for (const m of Array.isArray(b) ? b : [b]) {
            if (m.method !== 'eth_call') continue;
            const to = String(m.params?.[0]?.to || '').toLowerCase(), data = String(m.params?.[0]?.data || '');
            if (to === MULTICALL && data.startsWith('0x82ad56cb')) n.aggregate3++;
            else if (data.startsWith('0x01ffc9a7')) n.supportsInterface++;
            else if (data.startsWith('0x4aa3adb3')) n.abxVersion++;
        }
    });
    return n;
}
const settled = () => !/Loading your folder|Looking inside|Finding this address|Checking|Opening/.test(document.body.innerText);
async function openContract(page, addr) {
    await page.goto(base, { waitUntil: 'load' });
    await page.fill('#address', addr);
    await page.press('#address', 'Enter');
    await page.waitForTimeout(800);
    // A contract present on several chains asks for a network; take the first.
    const choice = page.locator('#network-dialog[open] #network-choices button').first();
    if (await choice.count()) await choice.click();
    await page.waitForFunction(settled, null, { timeout: 180000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const main = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    return main.slice(0, 400);
}
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

const page = await context.newPage();
const first = counter(page);
const views1 = [];
for (const c of contracts) views1.push(await openContract(page, c));
const before = await page.evaluate(readClasses);
console.log(`first pass: ${before.length} cached class(es); aggregate3 ${first.aggregate3}, supportsInterface ${first.supportsInterface}, abxVersion ${first.abxVersion}`);
for (const r of before) console.log(`   ${r.key} ${r.standard} abx${r.abxVersion || 0} ${r.name || ''}`);
if (!before.length) { console.log('ERR nothing cached; cannot test'); await browser.close(); process.exit(2); }
const flipped = await page.evaluate(flipClasses);
const planted = new Map((await page.evaluate(readClasses)).map((r) => [r.key, r]));
console.log(`flipped ${flipped} entr${flipped === 1 ? 'y' : 'ies'}`);
await page.close();

const page2 = await context.newPage();
const second = counter(page2);
const views2 = [];
for (const c of contracts) views2.push(await openContract(page2, c));
const after = new Map((await page2.evaluate(readClasses)).map((r) => [r.key, r]));
console.log(`second pass: aggregate3 ${second.aggregate3}, supportsInterface ${second.supportsInterface}, abxVersion ${second.abxVersion}`);

let wrong = 0, corrected = 0;
for (const [key, p] of planted) {
    const a = after.get(key);
    if (a && a.standard === p.standard && (a.abxVersion || 0) === (p.abxVersion || 0)) { wrong++; console.log(`   still wrong: ${key} ${a.standard} abx${a.abxVersion || 0}`); }
    else { corrected++; console.log(`   ${a ? 'restored' : 'dropped'}: ${key}${a ? ` ${a.standard} abx${a.abxVersion || 0}` : ''}`); }
}
let differ = 0;
contracts.forEach((c, i) => {
    if (views1[i] !== views2[i]) { differ++; console.log(`   view differs for ${c}:\n     1: ${views1[i].slice(0, 200)}\n     2: ${views2[i].slice(0, 200)}`); }
});
console.log(`planted ${planted.size}: corrected or dropped ${corrected}, still wrong ${wrong}; views differing ${differ}/${contracts.length}`);
await browser.close();
const ok = wrong === 0 && differ === 0;
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
