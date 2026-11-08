// Touch-screen styles: on a coarse pointer every form control is at least 16px (no iOS focus zoom) and the
// live-view back link is fully visible; on a mouse the compact desktop sizes stay; :hover styles apply only
// where the device can hover.
// usage: CHROME_PATH=... node touch-css.mjs <base url>
import { chromium } from 'playwright-core';

const [base] = process.argv.slice(2);
const controls = ['.addressbar input', '.sort select', '.mode-switch select', '.chain-picker select'];
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined });
let failed = 0;

async function measure(contextOpts) {
    const ctx = await browser.newContext(contextOpts);
    const page = await ctx.newPage();
    await page.goto(base, { waitUntil: 'load' });
    const out = await page.evaluate((sels) => {
        const sizes = {};
        for (const s of sels) {
            const el = document.querySelector(s);
            sizes[s] = el ? parseFloat(getComputedStyle(el).fontSize) : null;
        }
        const back = document.createElement('a');
        back.className = 'live-back';
        document.body.append(back);
        const backOpacity = getComputedStyle(back).opacity;
        back.remove();
        return { sizes, backOpacity, hover: matchMedia('(hover: hover)').matches, coarse: matchMedia('(pointer: coarse)').matches };
    }, controls);
    await ctx.close();
    return out;
}

function check(label, ok, detail) {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${detail}`);
    if (!ok) failed++;
}

const touch = await measure({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
check('touch media', touch.coarse && !touch.hover, `coarse=${touch.coarse} hover=${touch.hover}`);
for (const [s, px] of Object.entries(touch.sizes)) check(`touch ${s}`, px !== null && px >= 16, `${px}px`);
check('touch .live-back opacity', touch.backOpacity === '1', touch.backOpacity);

const mouse = await measure({ viewport: { width: 1280, height: 900 } });
check('mouse media', !mouse.coarse && mouse.hover, `coarse=${mouse.coarse} hover=${mouse.hover}`);
for (const [s, px] of Object.entries(mouse.sizes)) check(`mouse ${s}`, px !== null && px < 16, `${px}px (compact desktop size kept)`);
check('mouse .live-back opacity', mouse.backOpacity === '0.5', mouse.backOpacity);

await browser.close();
console.log(failed ? `${failed} failure(s)` : 'all PASS');
process.exit(failed ? 1 : 0);
