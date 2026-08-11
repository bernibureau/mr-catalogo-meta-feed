# mr-catalogo-meta-feed

Feed de catálogo de **Meta** para **Membership Rewards** (American Express AR), generado a partir
del catálogo público de canje. Alimenta la campaña de **Catálogo de Productos** (Deep Beacon).

## Feed

- **URL (raw):** `https://raw.githubusercontent.com/bernibureau/mr-catalogo-meta-feed/main/docs/feed.csv`
- Se conecta en **Commerce Manager → Catálogo → Fuentes de datos → URL programada**.
- Formato de catálogo de Meta (CSV). Imágenes a 1000×1000.

## Cómo funciona

`scraper.js` recorre el catálogo por categoría con paginación GET (`/Compras/{Categoría}?pg=N`),
sin login ni navegador. Genera:

- `docs/feed.csv` — el feed que consume Meta.
- `docs/products.json` — data cruda por producto (debug).

El workflow **`feed-daily`** lo corre **una vez por día** (06:00 UTC / 03:00 AR) y commitea el feed
si cambió. También se puede disparar a mano desde la pestaña Actions (`workflow_dispatch`).

```bash
npm run build   # = node scraper.js
```

## Notas

- **Precio:** el catálogo está en **puntos**, no en pesos. El campo `price` va con un placeholder
  (`1.00 ARS`) y los puntos viajan en `title` y `custom_label_0`. **En la plantilla del anuncio hay
  que ocultar el precio.**
- **id = SKU.** La campaña es de **tráfico**, así que el id no necesita matchear ningún píxel.
- Repo público sólo por la cuota de GitHub Actions. Los datos del catálogo son públicos.
