import { launchChrome } from "./chrome.js";
import { attachPage } from "../src/driver.js";

/**
 * Foto del carrito autenticado: qué pide Spaceship para dejar pagar.
 * No llena la tarjeta.
 */
const chrome = await launchChrome({ headed: true, profileDir: ".agent-profile" });
const { browser, page } = await attachPage(chrome.cdpUrl);
try {
  await page.goto("https://www.spaceship.com/cart/", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(8_000);

  const before = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 1800),
    buttons: [...document.querySelectorAll("button, a")]
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => (el as HTMLElement).innerText.replace(/\s+/g, " ").trim().slice(0, 80))
      .filter((t) => t !== ""),
    inputs: [...document.querySelectorAll("input, select")].map((el) => {
      const i = el as HTMLInputElement;
      return {
        type: i.type,
        name: i.name,
        id: i.id,
        placeholder: i.placeholder,
        visible: i.offsetParent !== null,
      };
    }),
  }));
  console.log("ANTES", JSON.stringify(before, null, 2));

  const checkout = page.getByRole("button", { name: /^\s*checkout\s*$/i }).first();
  if ((await checkout.count()) > 0) {
    await checkout.click().catch(() => undefined);
    await page.waitForTimeout(3_000);
  }
  const take = page.getByText("Take me there", { exact: false }).first();
  console.log("take", { count: await take.count() });
  await take.click({ timeout: 8_000 }).catch((e: Error) => console.log("take click:", e.message));
  await page.waitForTimeout(6_000);

  const after = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 1800),
  }));
  console.log("DESPUES", JSON.stringify(after, null, 2));
  console.log(
    "FRAMES",
    page.frames().map((f) => f.url()),
  );
} finally {
  await browser.close();
  await chrome.kill();
}
