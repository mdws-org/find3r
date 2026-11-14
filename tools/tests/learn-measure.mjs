// The help page (/learn) keeps the thebenmeadows.com reading measure: at 1440px its paragraphs and list
// items are 16px or larger, the median line is at most 75 characters and no block's average line passes
// 85; at 390px none of them is justified. The app's window UI is not measured.
// usage: CHROME_PATH=... node learn-measure.mjs <base url>
import { chromium } from 'playwright-core';

const [base] = process.argv.slice(2);
const MEDIAN_MAX = 75, LINE_MAX = 85, BODY_MIN = 16;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined });
let failed = 0;
const say = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failed++; };

for (const [width, height] of [[1440, 900], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(new URL('learn.html', base).href, { waitUntil: 'load' });
    const blocks = await page.evaluate(() => [...document.querySelectorAll('.learn p, .learn li')].flatMap((el) => {
        if (el.querySelector('p, li')) return [];
        const text = el.innerText.replace(/\s+/g, ' ').trim();
        const range = document.createRange();
        range.selectNodeContents(el);
        const tops = new Set([...range.getClientRects()].filter((r) => r.width > 2).map((r) => Math.round(r.top / 4)));
        const cs = getComputedStyle(el);
        return tops.size >= 3 ? [{ text: text.slice(0, 40), cpl: text.length / tops.size, size: parseFloat(cs.fontSize), align: cs.textAlign }] : [];
    }));
    if (width === 1440) {
        const cpl = blocks.map((b) => b.cpl).sort((a, b) => a - b);
        const median = cpl[Math.floor(cpl.length / 2)];
        say(median <= MEDIAN_MAX, `median line ${Math.round(median)} characters at 1440px (max ${MEDIAN_MAX}, ${blocks.length} blocks)`);
        const long = blocks.filter((b) => b.cpl > LINE_MAX);
        say(!long.length, `no block over ${LINE_MAX} characters a line${long.length ? `: "${long[0].text}" runs ${Math.round(long[0].cpl)}` : ''}`);
        const small = blocks.filter((b) => b.size < BODY_MIN);
        say(!small.length, `text at ${BODY_MIN}px or more${small.length ? `: "${small[0].text}" is ${small[0].size}px` : ''}`);
    } else {
        const just = blocks.filter((b) => b.align === 'justify');
        say(!just.length, 'nothing justified at 390px');
    }
    await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
