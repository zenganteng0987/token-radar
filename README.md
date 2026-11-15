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
radar: sortable and filterable board, a detail view per protocol with the
model's working, its tokened peers and its farm plan. Views can be linked
with `?select=<slug>`, `?category=<name>`, `?chain=<name>` and `?watch=1`.

## Layout

- `main.ts` — the entry program: snapshot in, board + dashboard data out.
- `lib/model.ts` — the value model, the farm plans and the gate self-check.
- `dashboard/` — the static page (no network, no framework).
- `screenshots/` — the board, a detail view and a filtered view.
- `vendor/makefun-board.ts` — the make.fun dossier library.
