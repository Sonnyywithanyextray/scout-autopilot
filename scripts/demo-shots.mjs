// Drives the demo in headless Chrome and saves screenshots to .shots/.
// Usage: node scripts/demo-shots.mjs [utterance] [card|box] [prefix]
import { chromium } from 'playwright-core'

const utterance = process.argv[2] ?? 'Too far from BART. Anything over 10 minutes walking from rapid transit should rank much lower.'
const mode = process.argv[3] ?? 'card'
const prefix = process.argv[4] ?? ''
const base = 'http://localhost:3002'
const shot = (name, opts = {}) => page.screenshot({ path: `.shots/${prefix}${name}.png`, ...opts })

await fetch(`${base}/api/reset`, { method: 'POST' })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text()))

await page.goto(base, { waitUntil: 'networkidle' })
await page.locator('button.btn.primary').click()
await page.getByText('Top matches').waitFor({ timeout: 15000 })
await page.waitForTimeout(600)
await shot('1-baseline')

if (mode === 'card') {
  await page.locator('article.card').first().getByRole('button', { name: 'Not for me' }).click()
  await page.getByPlaceholder("What's wrong with it? Scout will learn from this.").fill(utterance)
  await page.getByRole('button', { name: 'Teach Scout' }).click()
} else {
  await page.getByPlaceholder(/Tell Scout/).fill(utterance)
  await page.getByRole('button', { name: 'Teach', exact: true }).click()
}
await page.waitForTimeout(2500)
await shot('2-learning')

await page.locator('.hero-delta').waitFor({ timeout: 45000 })
await page.waitForTimeout(2200) // let the count animation finish
await shot('3-after')
await shot('3-after-full', { fullPage: true })

const near = page.locator('.nm-row').first()
if (await near.count()) {
  await near.click()
  await page.locator('.nm-body').first().waitFor()
  await page.locator('.near').screenshot({ path: `.shots/${prefix}5-near-miss.png` })
}
const firstCard = page.locator('article.card').first()
await firstCard.screenshot({ path: `.shots/${prefix}6-top-card.png` })

await page.setViewportSize({ width: 400, height: 860 })
await page.waitForTimeout(400)
await shot('4-mobile')

console.log(errors.length ? `PAGE ERRORS:\n${errors.join('\n')}` : 'no page errors')
await browser.close()
