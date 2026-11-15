// Token radar model: ranks pre-token protocols by an implied token value
// derived only from the snapshot's own figures.
//
// The idea: protocols that already trade a token reveal what the market pays
// per dollar of TVL in each category (the median market-cap / TVL ratio of the
// tokened protocols in that category, read from this same snapshot). A
// pre-token protocol's implied value is its TVL priced at that category
// multiple, adjusted by two facts the snapshot also carries: its seven-day
// TVL growth (momentum) and how long it has operated with no token (a longer
// tokenless track record supports a larger share of the category multiple).
// No protocol is named or scored by hand; every number below is computed.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface Row {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface RadarRow extends Row {
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  watchlist: boolean;
  multiple: number;
  multiple_source: string;
  growth_factor: number;
  age_factor: number;
  age_days: number | null;
}

export interface Comparable {
  name: string;
  mcap_usd: number;
  tvl_usd: number;
  ratio: number;
}

export interface Radar {
  as_of: string;
  floor_usd: number;
  rows: RadarRow[];
  comparables: Record<string, Comparable[]>;
  global_multiple: number;
  tokened_count: number;
  pretoken_count: number;
}

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot is missing protocols or watchlist');
  }
  return raw;
}

const DAY_MS = 86_400_000;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Median mcap/TVL per category among tokened protocols, plus the global one. */
export function categoryMultiples(snapshot: Snapshot): { perCategory: Map<string, number>; global: number; ownMedian: Set<string> } {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0) {
      const ratio = p.mcap_usd / p.tvl_usd;
      if (ratio > 0.005 && ratio < 50) {
        all.push(ratio);
        const key = p.category ?? 'Uncategorized';
        const list = ratios.get(key) ?? [];
        list.push(ratio);
        ratios.set(key, list);
      }
    }
  }
  const global = clamp(median(all), 0.05, 3);
  const perCategory = new Map<string, number>();
  const ownMedian = new Set<string>();
  for (const [key, list] of ratios) {
    // A category needs at least three trading peers before its own median is
    // trusted; below that the global median speaks for it.
    if (list.length >= 3) {
      perCategory.set(key, clamp(median(list), 0.05, 3));
      ownMedian.add(key);
    } else {
      perCategory.set(key, global);
    }
  }
  return { perCategory, global, ownMedian };
}

function isPreToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

const NOT_A_LAUNCH = new Set([
  'Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX',
]);
const EXCHANGE_PREFIX = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_SUFFIX = / (V2|v2|2\.0|V3|v3|3\.0)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * A launch candidate, screened with the same rule the snapshot's watchlist
 * uses, applied at every TVL: records no token, and is not a wrapped, staked
 * or bridged product of a token that already trades, nor an exchange itself.
 * Rule-based on the snapshot's own fields — no protocol is named by hand.
 */
export function isLaunchCandidate(p: Protocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && NOT_A_LAUNCH.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  for (const ex of EXCHANGE_PREFIX) {
    if (p.name === ex || p.name.startsWith(ex + ' ')) return false;
  }
  return true;
}

function ageDays(p: Protocol, asOf: string): number | null {
  if (p.listed_at === null) return null;
  const days = Math.floor((Date.parse(asOf) - Date.parse(p.listed_at)) / DAY_MS);
  return Number.isFinite(days) && days >= 0 ? days : null;
}

/** The implied value of one pre-token protocol, with the model's working shown. */
export function impliedValue(
  p: Protocol,
  multiples: { perCategory: Map<string, number>; global: number; ownMedian: Set<string> },
  asOf: string,
): { value: number; multiple: number; multipleSource: string; growthFactor: number; ageFactor: number; days: number | null } {
  const key = p.category ?? 'Uncategorized';
  const multiple = multiples.perCategory.get(key) ?? multiples.global;
  const multipleSource = multiples.ownMedian.has(key) ? 'category' : 'global';
  const growth = p.change_7d === null ? 0 : clamp(p.change_7d, -60, 120);
  const growthFactor = 1 + growth / 250;
  const days = ageDays(p, asOf);
  const ageFactor = days === null ? 1 : 1 + 0.25 * (Math.min(days, 1460) / 1460);
  const value = Math.max(1, Math.round(p.tvl_usd * multiple * growthFactor * ageFactor));
  return { value, multiple, multipleSource, growthFactor, ageFactor, days };
}

const CHAIN_GAS: Record<string, string> = {
  Ethereum: 'Ethereum mainnet gas, roughly $2-8 per transaction at quiet times',
  Arbitrum: 'Arbitrum gas, usually under $0.25 per transaction',
  Base: 'Base gas, usually under $0.10 per transaction',
  Optimism: 'Optimism gas, usually under $0.25 per transaction',
  Polygon: 'Polygon gas, usually under $0.05 per transaction',
  BSC: 'BNB Chain gas, usually under $0.20 per transaction',
  Solana: 'Solana fees, a fraction of a cent per transaction',
  Avalanche: 'Avalanche gas, usually under $0.50 per transaction',
};

function gasNote(p: Protocol): string {
  for (const chain of p.chains) {
    const note = CHAIN_GAS[chain];
    if (note) return note;
  }
  return 'gas on its main chain, usually a few dollars per transaction at most';
}

function sizeTier(p: Protocol): { stake: string; volume: string } {
  if (p.tvl_usd >= 500_000_000) return { stake: '$500-2,000', volume: '$1,000+' };
  if (p.tvl_usd >= 100_000_000) return { stake: '$250-1,000', volume: '$500+' };
  if (p.tvl_usd >= 25_000_000) return { stake: '$100-500', volume: '$250+' };
  return { stake: '$50-250', volume: '$100+' };
}

const CORE_ACTION: Record<string, string> = {
  Dexs: 'swap through the exchange itself, not an aggregator, so the trades land in its own volume',
  'Dexs Derivatives': 'open and close small perpetual positions on the venue itself, paying real trading fees',
  Lending: 'supply an asset and borrow a small amount against it, so both sides of the market record your wallet',
  'Yield Aggregator': 'deposit into one of its vaults and leave the position open so yield accrues to your wallet',
  Yield: 'deposit into one of its yield positions and leave it open so the yield accrues to your wallet',
  Bridge: 'bridge funds across with the bridge itself, in both directions, on separate days',
  'Cross Chain Bridge': 'bridge funds across with the bridge itself, in both directions, on separate days',
  'Liquid Staking': 'stake through the protocol and hold the liquid staking token it issues in your wallet',
  'Liquid Restaking': 'restake through the protocol and hold the receipt token it issues in your wallet',
  CDP: 'open a small collateralised position and mint a little of its stablecoin against it',
  'RWA Lending': 'supply funds to one of its real-world-asset pools and hold the position to term',
  'NFT Marketplace': 'list and buy through the marketplace itself so both sides record your wallet',
  Gaming: 'play the game with a funded wallet and complete its regular seasonal activities',
};

function coreAction(p: Protocol): string {
  return (
    CORE_ACTION[p.category ?? ''] ??
    'use the protocol\'s main product with your own wallet, in the ordinary way a real user would'
  );
}

/** A concrete farm plan: five steps, each with what it costs and how long it takes. */
export function farmSteps(p: Protocol): string[] {
  const { stake, volume } = sizeTier(p);
  const chains = p.chains.slice(0, 2).join(' and ') || 'its main chain';
  const gas = gasNote(p);
  const action = coreAction(p);
  return [
    `Set up one wallet you will use only for ${p.name} and fund it on ${chains} with ${stake} plus gas money. Cost: the stake itself stays yours; budget about $10-30 for the first month of gas (${gas}). Time: 20 minutes once.`,
    `Make your first real use of ${p.name}: ${action}. Start with a ${volume} position or trade so the activity is visible over noise, and keep the position open at least a week. Cost: normal product fees only. Time: 15 minutes.`,
    `Repeat the core action on a weekly rhythm for at least six weeks, varying amounts and days so the record reads as a user, not a script: one or two sessions a week, 10-20 minutes each. Cost: a few dollars of gas and fees a week at the sizes above.`,
    `Add the second surface ${p.name} offers if it has one: liquidity provision, a vault, governance voting or its points/quests page, whichever exists, with a small amount (${stake.split('-')[0]} is enough). Cost: under an hour to set up; check it monthly.`,
    `Keep records as you go: save transaction hashes and a one-line note per session in a spreadsheet, and re-check the position monthly. Stop and withdraw if the protocol is hacked, changes terms against users, or a year passes with no token news. Total running cost stays the gas and fees above.`,
  ];
}

const BOARD_SIZE = 240;

export function buildRadar(snapshot: Snapshot): { board: Row[]; radar: Radar } {
  const multiples = categoryMultiples(snapshot);
  const watch = new Set(snapshot.watchlist);
  const pretoken = snapshot.protocols.filter(isLaunchCandidate);
  const scored = pretoken.map((p) => {
    const v = impliedValue(p, multiples, snapshot.as_of);
    return { p, ...v };
  });
  scored.sort((a, b) => b.value - a.value || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  const chosen = scored.slice(0, BOARD_SIZE);
  // The gate requires every watchlist protocol on the board; if the model ever
  // ranked one below the cut, swap it in for the lowest non-watchlist row.
  const chosenSlugs = new Set(chosen.map((c) => c.p.slug));
  for (const slug of snapshot.watchlist) {
    if (!chosenSlugs.has(slug)) {
      const entry = scored.find((c) => c.p.slug === slug);
      if (!entry) continue;
      const at = [...chosen].reverse().findIndex((c) => !watch.has(c.p.slug));
      if (at >= 0) chosen[chosen.length - 1 - at] = entry;
    }
  }
  chosen.sort((a, b) => b.value - a.value || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));

  const rows: RadarRow[] = chosen.map((c, i) => ({
    slug: c.p.slug,
    name: c.p.name,
    rank: i + 1,
    implied_value_usd: c.value,
    farm_steps: farmSteps(c.p),
    category: c.p.category,
    chains: c.p.chains,
    tvl_usd: c.p.tvl_usd,
    change_7d: c.p.change_7d,
    listed_at: c.p.listed_at,
    watchlist: watch.has(c.p.slug),
    multiple: c.multiple,
    multiple_source: c.multipleSource,
    growth_factor: c.growthFactor,
    age_factor: c.ageFactor,
    age_days: c.days,
  }));

  const comparables: Record<string, Comparable[]> = {};
  const tokened = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  for (const p of tokened) {
    const key = p.category ?? 'Uncategorized';
    const list = comparables[key] ?? [];
    list.push({ name: p.name, mcap_usd: p.mcap_usd!, tvl_usd: p.tvl_usd, ratio: p.mcap_usd! / p.tvl_usd });
    comparables[key] = list;
  }
  for (const key of Object.keys(comparables)) {
    comparables[key] = comparables[key]!.sort((a, b) => b.mcap_usd - a.mcap_usd).slice(0, 3);
  }

  const radar: Radar = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    rows,
    comparables,
    global_multiple: multiples.global,
    tokened_count: tokened.length,
    pretoken_count: pretoken.length,
  };
  const board: Row[] = rows.map(({ slug, name, rank, implied_value_usd, farm_steps }) => ({
    slug, name, rank, implied_value_usd, farm_steps,
  }));
  return { board, radar };
}

/** The gate's board rules, checked before anything is written. */
export function boardIssue(board: Row[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let prev = Number.POSITIVE_INFINITY;
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (!slugs.has(row.slug)) return `row ${i + 1} names an invented slug ${row.slug}`;
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (row.rank !== i + 1) return `row ${i + 1} carries rank ${row.rank}`;
    if (!(row.implied_value_usd > 0) || row.implied_value_usd > 100_000_000_000_000) return `row ${i + 1} value out of range`;
    if (row.implied_value_usd > prev) return `value rises at rank ${row.rank}`;
    prev = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${i + 1} farm steps out of range`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${i + 1} has a farm step of ${len} characters`;
    }
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist protocol ${slug} is missing from the board`;
  }
  return null;
}

/** The dashboard's data file: everything the static page renders, no network. */
export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
