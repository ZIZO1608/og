# server/supabase — the cloud copy's SQL, run by hand

Supabase holds the mirror of the shop (see "Supabase — a one-way mirror, and the baton" in
`CLAUDE.md`) and, beside it, the website's and the VPS's doors. **Nothing here runs by itself.**
Each file is pasted into **Supabase → SQL Editor** and run once. Every file is safe to run again.

**To see what the live project already has, paste [`status.sql`](status.sql).** It only looks, and
answers one row per file: installed or not. Nothing else can tell you — the laptop cannot see
functions or roles, and nothing records that a file was pasted.

## The order

**1. The mirror itself — `CATCH-UP.sql`** (`001`–`029`, plus `036`, concatenated). One paste.
`001` alone first on a brand-new project.

**2. After that, two families.** Both are numbered from `030`, because they were written on
different branches at the same time — the file NAME is what tells them apart. Within a family, run
top to bottom; the two families do not depend on each other.

| The website (Ahmad's OG Sports site) | | The VPS (og-bridge: `/snapshot`, night mode) | |
|---|---|---|---|
| `030_web_orders.sql` | orders wait in the cloud for a yes | `030_erp_access.sql` | `og_vps`, a login that can only read |
| `031_web_payments.sql` | the owner chooses how it is paid | `031_till_status.sql` | whose mirror, and when it last heard |
| `036_product_photos.sql` | a colour's photos (also in CATCH-UP) | `033_og_vps_off_web.sql` | `og_vps` off the website's own tables |
| `037_web_products.sql` | products, priced in both currencies | `035_night_requests.sql` | night mode's requests wait in the cloud |

- Each website file has a `verify_…sql` beside it; run it straight after.
- **`030_erp_access.sql` grants `og_vps` read access to the mirror tables that exist when it
  runs.** Run it again after any file that creates a table (`036` did), then `033`.
- `032_extra_accounts.sql` is **not a step**: a read-only look at eight old accounts, a reversible
  switch-off, and a delete that is commented out on purpose. `npm run users:mirror -- --apply`
  is the tool for that job.
- `undo_035_night_requests.sql` takes night mode's cloud half away again, leaving `og_vps`
  exactly as `030` and `031` made it.

## After a file that adds a column to a mirrored table

Run `npm run supabase:reconcile` from `server/`. The sync pushed those rows with the column left
off and will not go back for them by itself. `npm run supabase:drift` says whether the shapes
now agree; `npm run supabase:check` whether the data does.

## The rules every new file here keeps

- `IF NOT EXISTS` / `CREATE OR REPLACE` everywhere, so a second run changes nothing.
- A new table gets `ENABLE ROW LEVEL SECURITY` with **no** policy, and the `GRANT … TO
  service_role` block (see `021_cash_book.sql` for the shape). A table made in the SQL editor is
  not readable by the shop's key on this project without it.
- A new file also gets a row in `status.sql`, or nobody can tell whether it went up.
