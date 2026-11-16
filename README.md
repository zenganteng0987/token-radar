[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/zenganteng0987/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/zenganteng0987/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

# Token Radar

A token launch radar for the make.fun `token-radar-01` bounty: it ranks
pre-token protocols by an implied token value derived only from the sealed
snapshot's own figures, and gives each one a concrete farm plan.

## The model

Protocols that already trade a token reveal what the market pays per dollar
of TVL in each category. The radar computes, from the snapshot itself, the
median market-cap / TVL ratio of the tokened protocols in every category
(a category needs at least three trading peers, otherwise the global median
speaks for it), then prices each pre-token protocol as:

```
implied value = TVL × category multiple × growth factor × age factor
```

- **growth factor** — from the protocol's seven-day TVL change, clamped.
- **age factor** — up to +25% for a long tokenless track record (four years).

The board is screened with the watchlist's own rule at every TVL: a protocol
must record no token and must not be a wrapped, staked or bridged product of
a token that already trades, nor an exchange itself. No protocol is named or
scored by hand; every number is computed from the snapshot.

## What v2 adds

- **The model's working, in the open.** Each protocol's detail view shows
  its full arithmetic: TVL, the multiple it was priced at, whether that
  multiple is its category's own median or the global one, exactly how many
  trading peers set it, the growth and age factors, and the category's
  largest trading peers. The page header carries every category's multiple
  and peer count, and an "Already trading" view lists the peers themselves,
  kept separate from the pre-token board they price.
- **Category farm playbooks.** Plans are written per category family —
  lending, DEX/liquidity, perps, restaking, stablecoin/yield, bridges —
  because farming a lending market (supply, borrow, watch the health
  factor) is not farming a DEX (swap, provide liquidity, mind impermanent
  loss). The top 50 rows carry a deep seven-step plan with the family's
  second mechanic and a fuller risk note; every other row carries five
  solid steps. Every step names its dollar cost and its time.
- **A rebuilt dashboard.** A dark sweep theme with a top-opportunities
  spotlight, tier badges, implied-vs-TVL bars, search, category filter,
  watchlist toggle, sortable columns and the pre-token / already-trading
  view switch.

The board holds all 200 protocols that pass the launch screens. The
snapshot's other 142 tokenless protocols are centralised exchanges,
wrapped or staked products of tokens that already trade, and canonical
bridges — the same subjects the watchlist's own rule refuses — so the
board takes every genuine candidate rather than pad itself with
non-launches.

## Run it locally

```
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Node 22, standard library only. This writes `board.json` (the ranked board),
`data.js` (the dashboard's data), `dashboard/` and `screenshots/` into the
output directory, plus `dossier.json`, the summary the judge reads, built
with the vendored `vendor/makefun-board.ts`.

Open `out/dashboard/index.html` in a browser (served over HTTP) to use the
radar. Views can be linked: `?select=<slug>`, `?cat=<category>`,
`?watch=1`, `?q=<text>`, `?view=tokened`, `?sort=<key>&dir=-1`.

## Layout

- `main.ts` — the entry program: snapshot in, board + dashboard data out.
- `lib/model.ts` — the value model, the farm playbooks and the gate self-check.
- `dashboard/` — the static page (no network, no framework).
- `screenshots/` — the board, a detail view and a filtered view.
- `vendor/makefun-board.ts` — the make.fun dossier library.
