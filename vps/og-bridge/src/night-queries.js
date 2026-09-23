/* ==========================================================================
   What night mode reads from the mirror, as og_vps.        [night-queries.js]
   --------------------------------------------------------------------------
   Every statement is a SELECT over tables 030 granted og_vps, run in the
   role's own read-only default — never inside mirror.submit()'s READ WRITE.
   Text a person typed only ever arrives as a PARAMETER, and a LIKE pattern
   has its % and _ escaped first, so "50%" is searched for, not obeyed.

   The WHEREs follow the till's own: a product is on sale when it is not
   hidden (archived) and not demo; a customer is a live one when it is not
   archived, not merged into another, not demo. pg returns BIGINT as a string,
   so night.js turns every number it draws into a Number itself.
   ========================================================================== */

export const likeEsc = (s) => String(s).replace(/[\\%_]/g, (c) => '\\' + c);

/* Words a person typed: at most four, each at least one character. */
export function words(q) {
  return String(q || '').trim().split(/\s+/).filter(Boolean).slice(0, 4).map((w) => w.slice(0, 40));
}

/* The products a search means: EVERY word must match the name, the brand,
   the colourway, a size, a SKU, a barcode or a label code — the order desk's
   rule, so "samba 42" finds the Samba that comes in a 42. With no words, the
   products changed most recently. */
export function stockSearch(q, limit = 12) {
  const ws = words(q);
  const params = [];
  const conds = ws.map((w) => {
    params.push('%' + likeEsc(w) + '%');
    const like = '$' + params.length;
    params.push(w);
    const exact = '$' + params.length;
    return `(p.name ILIKE ${like} ESCAPE '\\' OR coalesce(p.brand, '') ILIKE ${like} ESCAPE '\\'
             OR coalesce(p.colorway, '') ILIKE ${like} ESCAPE '\\'
             OR EXISTS (SELECT 1 FROM public.variants v
                         WHERE v.product_id = p.id
                           AND (v.size = ${exact} OR v.sku ILIKE ${like} ESCAPE '\\'
                                OR v.barcode = ${exact} OR v.label_code = ${exact})))`;
  });
  params.push(limit);
  return {
    sql: `SELECT p.id FROM public.products p
           WHERE NOT p.hidden AND NOT p.demo ${conds.map((c) => 'AND ' + c).join(' ')}
           ORDER BY ${ws.length ? 'p.name, p.id' : 'p.updated_at DESC, p.id DESC'}
           LIMIT $${params.length}`,
    params
  };
}

/* Every size of those products, with what each place holds. */
export const STOCK_ROWS = `
  SELECT p.id, p.name, p.brand, p.colorway, p.currency, p.selling_price,
         v.sku, v.size, v.colour_id, c.name_en AS colour, c.name_ar AS colour_ar, c.sort AS colour_sort,
         (SELECT count(*) FROM public.product_colours c2 WHERE c2.product_id = p.id) AS colours,
         s.wh_id, s.qty
    FROM public.products p
    JOIN public.variants v ON v.product_id = p.id
    LEFT JOIN public.product_colours c ON c.id = v.colour_id
    LEFT JOIN public.stock s ON s.sku = v.sku
   WHERE p.id = ANY($1::bigint[]) AND NOT p.hidden AND NOT p.demo`;

/* A handful of SKUs, for the request's own lines (what they are, how many). */
export const SKU_ROWS = `
  SELECT v.sku, v.size, p.id, p.name, p.brand, p.currency, p.selling_price,
         CASE WHEN (SELECT count(*) FROM public.product_colours c2 WHERE c2.product_id = p.id) > 1
              THEN c.name_en END AS colour,
         CASE WHEN (SELECT count(*) FROM public.product_colours c2 WHERE c2.product_id = p.id) > 1
              THEN c.name_ar END AS colour_ar,
         (SELECT coalesce(sum(s.qty), 0) FROM public.stock s WHERE s.sku = v.sku) AS qty
    FROM public.variants v
    JOIN public.products p ON p.id = v.product_id
    LEFT JOIN public.product_colours c ON c.id = v.colour_id
   WHERE v.sku = ANY($1::text[]) AND NOT p.hidden AND NOT p.demo`;

export const WAREHOUSES = `SELECT id, name, name_ar, kind, sort FROM public.warehouses ORDER BY sort, id`;
export const CURRENCIES = `SELECT code, minor_exp FROM public.currencies`;

/* The digits of a phone as a person types them, reduced to what every
   spelling of the same number shares: no 00, no 963, no trunk 0. */
export function phoneCore(q) {
  let d = String(q || '').replace(/[^0-9]/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('963')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  return d;
}

/* Customers by name or phone. Nothing is listed for an empty search: at
   night the list is a lookup, not a directory to scroll. */
export function customerSearch(q, limit = 20) {
  const text = String(q || '').trim().slice(0, 60);
  const core = phoneCore(text);
  return {
    sql: `SELECT c.id, c.name, c.phone, c.city
            FROM public.customers c
           WHERE NOT c.archived AND c.merged_into IS NULL AND NOT c.demo
             AND (c.name ILIKE $1 ESCAPE '\\'
                  OR ($2 <> '' AND regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') LIKE $3))
           ORDER BY c.updated_at DESC, c.id DESC
           LIMIT $4`,
    params: ['%' + likeEsc(text) + '%', core.length >= 3 ? core : '', '%' + core + '%', limit]
  };
}

export const CUSTOMER = `
  SELECT id, name, phone, city, address, note
    FROM public.customers
   WHERE id = $1 AND NOT archived AND merged_into IS NULL AND NOT demo`;

export const CUSTOMER_ORDERS = `
  SELECT s.id, s.at, s.currency, s.total, s.voided, s.payment, d.status, d.method, d.city
    FROM public.sales s
    LEFT JOIN public.deliveries d ON d.sale_id = s.id
   WHERE s.customer_id = $1
   ORDER BY s.at DESC
   LIMIT 10`;

export const ORDER_STATUSES = ['waiting', 'out', 'delivered', 'failed', 'cancelled'];

/* The last orders (a sale with a delivery row) and where each one is. A
   cancelled order is a voided sale, whatever its delivery row says. */
export function recentOrders(status, limit = 40) {
  const st = ORDER_STATUSES.includes(status) ? status : '';
  const where = st === 'cancelled' ? 'AND s.voided'
    : st ? 'AND NOT s.voided AND d.status = $1'
    : '';
  const params = st && st !== 'cancelled' ? [st, limit] : [limit];
  return {
    sql: `SELECT s.id, s.at, s.currency, s.total, s.voided, s.customer_name,
                 c.name AS customer, c.phone,
                 d.status, d.method, d.city, d.company_name, d.out_at, d.closed_at
            FROM public.sales s
            JOIN public.deliveries d ON d.sale_id = s.id
            LEFT JOIN public.customers c ON c.id = s.customer_id
           WHERE s.payment = 'order' ${where}
           ORDER BY s.at DESC
           LIMIT $${params.length}`,
    params
  };
}

export const ITEMS_OF = `
  SELECT sale_id, name, size, qty FROM public.sale_items
   WHERE sale_id = ANY($1::text[])
   ORDER BY sale_id, id`;
