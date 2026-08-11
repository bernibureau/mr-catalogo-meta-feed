/* Scraper del catálogo de Membership Rewards (Amex AR) -> feed de catálogo de Meta.
 *
 * El catálogo es público y server-rendered. Se recorre por categoría con paginación GET
 * (`/Compras/{Categoria}?pg=N`), sin login ni navegador headless. Alimenta la campaña de
 * Catálogo de Productos (tráfico) — no requiere píxel ni matching de evento de compra.
 *
 * Salida:
 *   docs/feed.csv       -> feed formato Meta (lo consume Commerce Manager por URL raw)
 *   docs/products.json  -> data cruda por producto (debug / trazabilidad)
 *
 * Uso:  node scraper.js
 */
const fs = require("fs");
const path = require("path");

const BASE = "https://www.americanexpress.com/es-ar/rewards/membership-rewards/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const RPS_DELAY = 500;   // ~2 req/s, gentil
const MAX_PAGES = 15;    // tope de seguridad por categoría

// slug de URL -> etiqueta legible (product_type)
const CATS = [
  ["Bazar", "Bazar"], ["Bebidas", "Bebidas"], ["Cocina", "Cocina"],
  ["Coffee_Break", "Coffee Break"], ["Cuidado_Personal_y_Bienestar", "Cuidado Personal y Bienestar"],
  ["Gift_Cards", "Gift Cards"], ["Hogar", "Hogar"], ["Outdoor", "Outdoor"],
  ["Peque%C3%B1os_Electro", "Pequeños Electro"], ["TV_y_Audio", "TV y Audio"],
  ["Tecno", "Tecno"], ["Vajilla", "Vajilla"],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decode(s) {
  return String(s || "")
    .replace(/&amp;/g, "&").replace(/&aacute;/g, "á").replace(/&eacute;/g, "é")
    .replace(/&iacute;/g, "í").replace(/&oacute;/g, "ó").replace(/&uacute;/g, "ú")
    .replace(/&Aacute;/g, "Á").replace(/&Eacute;/g, "É").replace(/&Iacute;/g, "Í")
    .replace(/&Oacute;/g, "Ó").replace(/&Uacute;/g, "Ú")
    .replace(/&ntilde;/g, "ñ").replace(/&Ntilde;/g, "Ñ").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "es-AR,es;q=0.9" } });
      if (r.ok) return r.text();
      if (r.status === 404) return "";
    } catch (e) { /* reintenta */ }
    await sleep(1000 * (i + 1));
  }
  return "";
}

// Parser por VENTANA de tarjeta: agnóstico al layout (destacados <p> vs categoría <h4>).
const ANCHOR = /<a\b[^>]*class="productImage"[^>]*>/gs;
function parse(html, categoria) {
  const anchors = [...html.matchAll(ANCHOR)];
  const out = [];
  for (let i = 0; i < anchors.length; i++) {
    const w = html.slice(anchors[i].index, i + 1 < anchors.length ? anchors[i + 1].index : anchors[i].index + 2500);
    const link = (w.match(/href="([^"]*\/award\/[^"?]+)/) || [])[1];
    if (!link) continue;
    const sku = (link.match(/\/award\/[^/]+\/([^/?"]+)/) || [])[1] || "";
    const productId = (w.match(/getcatalogimage\.mtw\?productid=(\d+)/) || [])[1];
    const brand = decode((w.match(/class="productBrand">([^<]*)/) || [])[1]);
    const name = decode((w.match(/class="productName">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/) || [])[1]);
    const pts = (w.match(/([\d.]+)\s*<span class="small">\s*puntos/) || [])[1];
    if (!sku || !productId || !pts) continue;
    out.push({
      sku, productId,
      marca: brand, nombre: name,
      titulo: [brand, name].filter(Boolean).join(" "),
      puntos: parseInt(pts.replace(/\./g, ""), 10),
      // master1 = 1000x1000 (Meta recomienda >=500). Se arma con el productId del listado.
      imagen: `${BASE}getcatalogimage.mtw?productid=${productId}&catalogid=132097&languageid=es_ar&imagetype=master1`,
      link, categoria,
    });
  }
  return out;
}

async function crawlCategory(slug, label, bySku) {
  let page = 1, total = 0;
  while (page <= MAX_PAGES) {
    const url = page === 1
      ? `${BASE}Compras/Cat%C3%A1logo/${slug}`
      : `${BASE}Compras/${slug}?pg=${page}`;
    const rows = parse(await get(url), label);
    if (!rows.length) break;
    let fresh = 0;
    for (const r of rows) if (!bySku.has(r.sku)) { bySku.set(r.sku, r); fresh++; }
    total += rows.length;
    await sleep(RPS_DELAY);
    if (fresh === 0 && page > 1) break; // dejó de traer nuevos
    page++;
  }
  return total;
}

const CSV_COLS = ["id", "title", "description", "availability", "condition", "price", "link", "image_link", "brand", "product_type", "custom_label_0"];
const esc = (v) => { v = String(v ?? ""); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
function toRow(r) {
  const pts = r.puntos.toLocaleString("es-AR");
  return [
    r.sku,
    `${r.titulo} — ${pts} puntos`,
    r.titulo,
    "in stock",
    "new",
    "1.00 ARS",           // placeholder: el catálogo es en PUNTOS. Ocultar el precio en la plantilla del anuncio.
    r.link,
    r.imagen,
    r.marca,
    r.categoria,
    `${pts} puntos`,
  ].map(esc).join(",");
}

(async () => {
  const bySku = new Map();
  for (const [slug, label] of CATS) {
    const n = await crawlCategory(slug, label, bySku);
    console.log(`${label.padEnd(30)} ${n}`);
  }
  const items = [...bySku.values()];
  if (items.length < 50) throw new Error(`Solo ${items.length} productos — el catálogo cambió de estructura, abortando para no publicar un feed roto.`);

  const outDir = path.join(__dirname, "docs");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "feed.csv"), [CSV_COLS.join(","), ...items.map(toRow)].join("\n") + "\n", "utf8");
  fs.writeFileSync(path.join(outDir, "products.json"), JSON.stringify(items, null, 2), "utf8");

  const pts = items.map((i) => i.puntos).sort((a, b) => a - b);
  console.log(`\nTotal: ${items.length} productos · puntos ${pts[0].toLocaleString("es-AR")}–${pts.at(-1).toLocaleString("es-AR")}`);
  console.log(`✓ docs/feed.csv · docs/products.json`);
})().catch((e) => { console.error(e.message); process.exit(1); });
