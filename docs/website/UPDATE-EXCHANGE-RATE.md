# Website update — the dollar rate now follows the market feed (24 Sep 2026)

For Ahmad. Nothing on the website has to change; this says where the rate comes from now, so
the site and the till never show two different numbers.

## What changed

- The shop's server reads the exchange-rates function
  (`https://aumzkcizwfnvnncggfpq.supabase.co/functions/v1/exchange-rates`) **every ten minutes**
  and writes the dollar rate into the shop — the same `fx_rates` row the owner used to type by
  hand. The owner chooses in Settings which side it follows (**sell** by default: what the shop
  pays for a dollar), and a jump bigger than 20 % is held until a person confirms it.
- `web_checkout` (`rate`) reads that row from the mirror, so it follows the till within seconds.
  Its `version` moves when the rate moves — an open checkout that re-reads on `version` (as the
  payment-methods update asked) redraws its lira prices by itself.

## What the website must (still) do

- **Use `web_checkout.rate` for every lira figure.** Do not call the exchange-rates function from
  the site for prices: it answers in **old lira** (13,750), the shop works in the redenominated
  lira (138), and the shop's guard would not apply. One number, one place.
- `rate.at` is when the rate last **moved**. The feed writes nothing while the market is still,
  so an old `rate.at` is normal on a quiet week and says nothing about whether the feed is
  working. The price is the shop's price either way.

## Nothing to run

No SQL, no new key, no new door. The contract (`PROMPT-FOR-AHMAD.md` §4) carries the same note
under `web_checkout`.
