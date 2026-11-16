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
  multiple_peers: number;
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

export interface TokenedRow {
  name: string;
  symbol: string | null;
  category: string | null;
  mcap_usd: number;
  tvl_usd: number;
  ratio: number;
}

export interface CategoryMultiple {
  category: string;
  multiple: number;
  peers: number;
  own: boolean;
}

export interface Radar {
  as_of: string;
  floor_usd: number;
  rows: RadarRow[];
  comparables: Record<string, Comparable[]>;
  category_multiples: CategoryMultiple[];
  tokened: TokenedRow[];
  global_multiple: number;
  global_peers: number;
  protocol_count: number;
  trading_count: number;
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

export interface Multiples {
  perCategory: Map<string, number>;
  counts: Map<string, number>;
  global: number;
  globalCount: number;
  ownMedian: Set<string>;
}

/** Median mcap/TVL per category among tokened protocols, plus the global one. */
export function categoryMultiples(snapshot: Snapshot): Multiples {
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
  const counts = new Map<string, number>();
  const ownMedian = new Set<string>();
  for (const [key, list] of ratios) {
    counts.set(key, list.length);
    // A category needs at least three trading peers before its own median is
    // trusted; below that the global median speaks for it.
    if (list.length >= 3) {
      perCategory.set(key, clamp(median(list), 0.05, 3));
      ownMedian.add(key);
    } else {
      perCategory.set(key, global);
    }
  }
  return { perCategory, counts, global, globalCount: all.length, ownMedian };
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
  multiples: Multiples,
  asOf: string,
): { value: number; multiple: number; multipleSource: string; multiplePeers: number; growthFactor: number; ageFactor: number; days: number | null } {
  const key = p.category ?? 'Uncategorized';
  const multiple = multiples.perCategory.get(key) ?? multiples.global;
  const own = multiples.ownMedian.has(key);
  const multipleSource = own ? 'category' : 'global';
  const multiplePeers = own ? multiples.counts.get(key)! : multiples.globalCount;
  const growth = p.change_7d === null ? 0 : clamp(p.change_7d, -60, 120);
  const growthFactor = 1 + growth / 250;
  const days = ageDays(p, asOf);
  const ageFactor = days === null ? 1 : 1 + 0.25 * (Math.min(days, 1460) / 1460);
  const value = Math.max(1, Math.round(p.tvl_usd * multiple * growthFactor * ageFactor));
  return { value, multiple, multipleSource, multiplePeers, growthFactor, ageFactor, days };
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
  Derivatives: 'open and close small perpetual positions on the venue itself, paying real trading fees',
  Lending: 'supply an asset and borrow a small amount against it, so both sides of the market record your wallet',
  'Risk Curators': 'deposit into one of the lending vaults it curates and leave the position open so yield accrues to your wallet',
  'Yield Aggregator': 'deposit into one of its vaults and leave the position open so yield accrues to your wallet',
  Yield: 'deposit into one of its yield positions and leave it open so the yield accrues to your wallet',
  Bridge: 'bridge funds across with the bridge itself, in both directions, on separate days',
  'Cross Chain Bridge': 'bridge funds across with the bridge itself, in both directions, on separate days',
  'Liquid Staking': 'stake through the protocol and hold the liquid staking token it issues in your wallet',
  'Liquid Restaking': 'restake through the protocol and hold the receipt token it issues in your wallet',
  Restaking: 'stake or restake through the protocol and hold the receipt it issues in your wallet',
  'Staking Pool': 'stake through the pool and hold the position in your wallet',
  CDP: 'open a small collateralised position and mint a little of its stablecoin against it',
  'CDP Manager': 'open a small collateralised position in one of the vaults it manages and mint a little stablecoin against it',
  'RWA Lending': 'supply funds to one of its real-world-asset pools and hold the position to term',
  RWA: 'supply funds to one of its real-world-asset pools and hold the position to term',
  'Onchain Capital Allocator': 'deposit into one of its allocation vaults and leave the position open so returns accrue to your wallet',
  'Basis Trading': 'open the cash-and-carry basis position it runs, at the size it asks for, and leave it open',
  'Liquidity Manager': 'deposit into one of the liquidity positions it manages and leave it open so fees accrue to your wallet',
  'NFT Marketplace': 'list and buy through the marketplace itself so both sides record your wallet',
  Gaming: 'play the game with a funded wallet and complete its regular seasonal activities',
  'Prediction Market': 'take small positions on both sides of its markets over time, at prices you can defend',
  Insurance: 'buy a small cover policy, or supply a little capital to one of its underwriting pools',
  Chain: 'bridge a little funds onto the chain and transact there: swaps, transfers and its native apps',
  Payments: 'make real payments through it: send and receive with the farming wallet in ordinary amounts',
  'Crypto Card Issuer': 'order its card if it offers one and route a little ordinary spending through it',
};

function coreAction(p: Protocol): string {
  return (
    CORE_ACTION[p.category ?? ''] ??
    'use the protocol\'s main product with your own wallet, in the ordinary way a real user would'
  );
}

/**
 * Farm plans are written per category family, because what farming a lending
 * market takes (supply, borrow, watch the health factor) is not what farming
 * a DEX takes (swap, provide liquidity, mind impermanent loss). Every step
 * names its cost and its time; the deep plan for the board's top rows adds
 * the family's second mechanic and a fuller risk note.
 */
type Family = 'lending' | 'dex' | 'perps' | 'restaking' | 'yield' | 'bridge' | 'generic';

const FAMILY_OF: Record<string, Family> = {
  Lending: 'lending',
  'Uncollateralized Lending': 'lending',
  'RWA Lending': 'lending',
  'Risk Curators': 'lending',
  'Collateral Markets': 'lending',
  'Collateral Management': 'lending',
  Dexs: 'dex',
  'Liquidity Manager': 'dex',
  Derivatives: 'perps',
  'Dexs Derivatives': 'perps',
  Options: 'perps',
  'Options Vault': 'perps',
  Synthetics: 'perps',
  'Interest Rate Derivatives': 'perps',
  Restaking: 'restaking',
  'Liquid Restaking': 'restaking',
  'Liquid Staking': 'restaking',
  'Staking Pool': 'restaking',
  'Anchor BTC': 'restaking',
  'Decentralized BTC': 'restaking',
  Yield: 'yield',
  'Yield Aggregator': 'yield',
  CDP: 'yield',
  'CDP Manager': 'yield',
  'Dual-Token Stablecoin': 'yield',
  'Algo-Stables': 'yield',
  'Stablecoin Issuer': 'yield',
  'Stablecoin Wrapper': 'yield',
  'Basis Trading': 'yield',
  'Leveraged Farming': 'yield',
  Farm: 'yield',
  'Onchain Capital Allocator': 'yield',
  RWA: 'yield',
  CeDeFi: 'yield',
  Indexes: 'yield',
  Bridge: 'bridge',
  'Cross Chain Bridge': 'bridge',
  'Canonical Bridge': 'bridge',
};

function familyOf(p: Protocol): Family {
  return FAMILY_OF[p.category ?? ''] ?? 'generic';
}

/** The family's second mechanic: the step that separates a farmer from a passer-by. */
function familyStepA(p: Protocol, fam: Family, small: string, gas: string): string {
  switch (fam) {
    case 'lending':
      return `Borrow against your supply: take a small stablecoin loan at under 40% of the borrowing limit, and either hold it or loop it back as supply exactly once. Cost: borrow interest, typically 2-8% APR on the borrowed slice, so a $200 loan costs under $2 a month. Time: 10 minutes, then a weekly health-factor check.`;
    case 'dex':
      return `Provide liquidity: open a small position in one of its main pairs with ${small} split across both assets, in a range you can leave alone for weeks. Cost: the swap and mint gas (${gas}); the position itself can lose to impermanent loss, so keep it small. Time: 20 minutes.`;
    case 'perps':
      return `Trade both sides over time: open long and short positions on different days and hold each at least a day, so the record is a trader's, not a single punt. Cost: taker fees plus funding, roughly $3-10 a week at the position sizes above. Time: 15 minutes a session.`;
    case 'restaking':
      return `Hold the receipt: keep the staking or restaking receipt in the farming wallet for at least eight weeks without selling or moving it, and claim whatever it pays into the same wallet. Cost: no running cost beyond the first gas; the stake sits behind the underlying unbonding period. Time: 5 minutes a month to check.`;
    case 'yield':
      return `Use the product's second market: for a CDP that means minting a little of its stablecoin against your collateral; for a vault, a second vault running a different strategy; for a stablecoin, holding and spending the coin itself. Size it at ${small}. Cost: mint or deposit fees plus gas (${gas}). Time: 15-20 minutes.`;
    case 'bridge':
      return `Bridge in both directions on separate days, varying the asset and the route: a stablecoin one week, the chain's gas token the next, each hop at the size above or more so the transfers clear the noise. Cost: bridge fees plus gas on both chains, roughly $2-10 a round trip. Time: 10 minutes a hop.`;
    default:
      return `Go one level deeper than the front door: use ${p.name}'s secondary feature — its app section, staking, governance, quests page or partner integration, whichever it has — with a small amount (${small}), so more than one product surface records the wallet. Cost: the product's own fees. Time: 30-45 minutes once.`;
  }
}

/** The family's third mechanic, used by the deep plan for the top rows. */
function familyStepB(p: Protocol, fam: Family, small: string, gas: string): string {
  switch (fam) {
    case 'lending':
      return `Work a second market or asset the venue offers: supply a different asset (the chain's gas token beside a stablecoin, say) or join its isolated or efficiency-mode market if it has one, with ${small}, so both markets record the wallet. Cost: one more round of gas (${gas}). Time: 15 minutes.`;
    case 'dex':
      return `Trade through the venue weekly in both directions, and if it runs a points or quests page, complete the trading quests it lists from the same wallet. Cost: swap fees on the weekly volume above, usually a few dollars. Time: 10-15 minutes a week.`;
    case 'perps':
      return `Use the venue's second surface: its liquidity or vault pool, isolated-margin mode or options desk, whichever it runs, with ${small} committed for at least a month. Cost: the deposit stays yours; vault shares can dip when traders win against the pool. Time: 15 minutes to set up.`;
    case 'restaking':
      return `Add the second layer it offers: restake the receipt into its restaking layer, or delegate part of the position to one of its operators or services if it runs them. Cost: one more transaction of gas (${gas}); slashing risk, though rare, is real and shared with the operator you pick. Time: 15 minutes.`;
    case 'yield':
      return `Let the yield compound untouched for at least eight weeks and harvest or claim rewards only into the same wallet, so the balance history shows a holder, not a flipper. Cost: nothing but patience. Time: 5 minutes a month to check the position and the peg.`;
    case 'bridge':
      return `Use the destination chain after you land: make one real transaction there — a swap or a deposit — before bridging back, so the record is usage and not just transit. Cost: destination gas, usually under $1 on a layer-2 chain. Time: 10 minutes.`;
    default:
      return `Add the social surfaces ${p.name} runs, if any: its points or quests page, governance votes on proposals you have actually read, and its testnet if it keeps one, all from the same wallet. Cost: gas only, a few dollars in total. Time: 20 minutes to set up, minutes a week after.`;
  }
}

/** The risk note, specific to the family's real failure modes. */
function familyRisk(p: Protocol, fam: Family): string {
  switch (fam) {
    case 'lending':
      return `Risk check: liquidation is the main danger — keep the health factor above 1.6, never borrow near the limit, and remember supplied assets can be frozen in a market exploit. Check weekly; if the health factor drifts under 1.4, repay or add collateral the same day.`;
    case 'dex':
      return `Risk check: liquidity positions lose to impermanent loss when prices move, and a young exchange can be exploited — keep the LP small, prefer its deepest pair, and withdraw if its TVL falls by half in a week or the team goes silent.`;
    case 'perps':
      return `Risk check: leverage liquidates — trade at 2-3x at most, size so a full liquidation costs under 5% of the farming budget, and never leave a position unmonitored over a weekend. Funding can turn against a crowded side; if it does, close and wait.`;
    case 'restaking':
      return `Risk check: the stake is locked behind an unbonding period of days to weeks, the receipt can trade below the underlying asset, and restaking adds slashing risk on top of staking. Only stake what you can leave untouched for months.`;
    case 'yield':
      return `Risk check: yield comes from somewhere — read where: lending interest, trading fees or emissions. Stablecoins can depeg and CDP collateral can be liquidated, so size the position to survive a 20% adverse move and check the peg monthly.`;
    case 'bridge':
      return `Risk check: bridges are among the most-hacked contracts in the industry — split larger moves across days, verify the destination address on the bridge's own interface every time, and never bridge to a chain you cannot transact on afterwards.`;
    default:
      return `Risk check: every smart contract can fail or be exploited, and a token is never promised — size the whole farm so losing it would sting but not hurt, and stop at once if ${p.name} is hacked or changes its terms against its users.`;
  }
}

/**
 * A concrete farm plan. The board's top rows get the deep plan: seven steps
 * with the family playbook in full. Every other row gets five solid steps.
 */
export function farmSteps(p: Protocol, deep: boolean): string[] {
  const { stake, volume } = sizeTier(p);
  const small = stake.split('-')[0]!;
  const chains = p.chains.slice(0, 2).join(' and ') || 'its main chain';
  const gas = gasNote(p);
  const fam = familyOf(p);
  const setup = `Open one wallet used only for ${p.name} and fund it on ${chains} with ${stake} plus gas money (${gas}). Cost: the stake itself stays yours; budget about $10-30 for the first month of gas. Time: 20 minutes once.`;
  const core = `Make the first real use of ${p.name}: ${coreAction(p)}. Size it at ${volume} so the activity shows above dust, and leave the position open at least a week. Cost: the product's normal fees only. Time: 15 minutes.`;
  const rhythm = deep
    ? `Hold a weekly rhythm for at least eight weeks: one or two sessions a week of 10-20 minutes, varying the day, the amount and the asset so the record reads as a person, not a script. Cost: a few dollars a week in gas and fees at the sizes above — roughly $30-80 across the eight weeks.`
    : `Hold a weekly rhythm for at least six weeks: one or two sessions a week of 10-20 minutes, varying amounts and days so the record reads as a user, not a script. Cost: a few dollars of gas and fees a week at the sizes above.`;
  const records = `Keep the receipts: save every transaction hash with a one-line note in a spreadsheet, review the position monthly, and watch ${p.name}'s own channels for token or points news. Withdraw if the protocol is hacked, turns against its users, or a year passes with no token news.`;
  if (deep) {
    return [setup, core, familyStepA(p, fam, small, gas), familyStepB(p, fam, small, gas), rhythm, familyRisk(p, fam), records];
  }
  return [setup, core, familyStepA(p, fam, small, gas), rhythm, `${familyRisk(p, fam)} Keep hashes and a one-line note per session in a spreadsheet as you go.`];
}

// The board takes every protocol that passes the launch screens, up to this
// cap. In this snapshot 200 pass: the other 142 protocols that record no
// token are centralised exchanges, wrapped or staked products of tokens that
// already trade, and canonical bridges of a chain — the same subjects the
// snapshot's own watchlist rule refuses — so the board holds all 200 rather
// than pad itself with non-launches to reach a rounder number.
const BOARD_SIZE = 400;

// Rows at or above this rank get the deep seven-step farm plan.
const DEEP_PLAN_RANK = 50;

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
    farm_steps: farmSteps(c.p, i < DEEP_PLAN_RANK),
    category: c.p.category,
    chains: c.p.chains,
    tvl_usd: c.p.tvl_usd,
    change_7d: c.p.change_7d,
    listed_at: c.p.listed_at,
    watchlist: watch.has(c.p.slug),
    multiple: c.multiple,
    multiple_source: c.multipleSource,
    multiple_peers: c.multiplePeers,
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

  // The trading side of the line, shown separately on the page: the largest
  // protocols whose token already trades, with the multiple the market
  // actually pays for them. These are the peers the model reads its
  // multiples from; they are never ranked on the board.
  const tokenedRows: TokenedRow[] = tokened
    .map((p) => ({
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      mcap_usd: p.mcap_usd!,
      tvl_usd: p.tvl_usd,
      ratio: p.mcap_usd! / p.tvl_usd,
      slug: p.slug,
    }))
    .sort((a, b) => b.mcap_usd - a.mcap_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, 24)
    .map(({ slug: _slug, ...rest }) => rest);

  const categoryMultipleTable: CategoryMultiple[] = [...multiples.perCategory.entries()]
    .map(([category, multiple]) => ({
      category,
      multiple,
      peers: multiples.counts.get(category) ?? 0,
      own: multiples.ownMedian.has(category),
    }))
    .sort((a, b) => (a.category < b.category ? -1 : 1));

  const radar: Radar = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    rows,
    comparables,
    category_multiples: categoryMultipleTable,
    tokened: tokenedRows,
    global_multiple: multiples.global,
    global_peers: multiples.globalCount,
    protocol_count: snapshot.protocols.length,
    trading_count: snapshot.protocols.filter((p) => !isPreToken(p)).length,
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
