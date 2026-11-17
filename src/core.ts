// Pure core for covid-flu-rsv-wastewater-levels-mcp. The only I/O is keyless reads of three CDC datasets on data.cdc.gov
// (Socrata SODA API), done through an injected fetchText.
//
// Sources (public, no key, updated weekly on Fridays):
//   CDC Wastewater Viral Activity Level (WVAL) for SARS-CoV-2, Influenza A and RSV:  https://data.cdc.gov/resource/atcp-73re.json
//     one row per sewershed site, pathogen and week: state_territory (full name), counties_served ("Los Angeles, Ventura"),
//     site ("ID:413"), population_served, site_wval, site_wval_category (Very Low .. Very High), week_end (text YYYY-MM-DD),
//     pathogen_target (SARS-CoV-2, Influenza A virus, RSV), date_updated
//   Level of Acute Respiratory Illness (ARI) Activity by State (emergency department visits): https://data.cdc.gov/resource/f3zz-zga5.json
//     week_end (timestamp), geography (state name or "United States"), label, percent_visits_ari
//   Percent of Tests Positive for Viral Respiratory Pathogens (national):  https://data.cdc.gov/resource/seuz-s2cv.json
//     week_end (timestamp), pathogen (COVID-19, Influenza, RSV), percent_test_positivity
import type { FetchText } from './types.js';

export const REPO = 'covid-flu-rsv-wastewater-levels-mcp';
export const SITE = 'https://www.mcpstamp.com';
export const UTM = `utm_source=mcp&utm_medium=${REPO}`;
export const more = () => `${SITE}/servers/?${UTM}`;
export const BASE = 'https://data.cdc.gov/resource';
export const DS = { wval: 'atcp-73re', ari: 'f3zz-zga5', positivity: 'seuz-s2cv' } as const;
export const SOURCE =
  'CDC National Wastewater Surveillance System viral activity levels (data.cdc.gov dataset atcp-73re), CDC acute respiratory illness emergency department activity by state (f3zz-zga5) ' +
  'and national percent of tests positive (seuz-s2cv). CDC updates them weekly on Fridays. Wastewater levels measure virus shed into sewers, not case counts. Not medical advice.';

export class InputError extends Error {}
export class UpstreamError extends Error {}

export type PathogenId = 'covid' | 'flu' | 'rsv';
export interface Pathogen { id: PathogenId; target: string; name: string; positivity: string }
export const PATHOGENS: Pathogen[] = [
  { id: 'covid', target: 'SARS-CoV-2', name: 'COVID-19', positivity: 'COVID-19' },
  { id: 'flu', target: 'Influenza A virus', name: 'Flu (influenza A)', positivity: 'Influenza' },
  { id: 'rsv', target: 'RSV', name: 'RSV', positivity: 'RSV' },
];
export const CATEGORIES = ['Very Low', 'Low', 'Moderate', 'High', 'Very High'];
const ARI_ORDER = ['Very Low', 'Low', 'Moderate', 'High', 'Very High'];

export function pathogensOf(p: unknown): Pathogen[] {
  const s = String(p ?? 'all').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (s === '' || s === 'all' || s === 'both') return PATHOGENS;
  if (['covid', 'covid19', 'sarscov2', 'coronavirus'].includes(s)) return [PATHOGENS[0]];
  if (['flu', 'influenza', 'influenzaa', 'fluavirus', 'influenzaavirus'].includes(s)) return [PATHOGENS[1]];
  if (s === 'rsv') return [PATHOGENS[2]];
  throw new InputError(`unknown pathogen "${p}". Use covid, flu, rsv or all.`);
}

// [code, name, name in the wastewater dataset if different, name in the ARI dataset if different]
const STATE_LIST: [string, string, string?, string?][] = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'],
  ['DE', 'Delaware'], ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'],
  ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'],
  ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'],
  ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'],
  ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'],
  ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'], ['PR', 'Puerto Rico'],
  ['VI', 'U.S. Virgin Islands', 'U.S. Virgin Islands', 'Virgin Islands'], ['GU', 'Guam'], ['AS', 'American Samoa'], ['MP', 'Northern Mariana Islands'],
];
export interface State { code: string; name: string; wval: string; ari: string }
const STATES: State[] = STATE_LIST.map(([code, name, wval, ari]) => ({ code, name, wval: wval ?? name, ari: ari ?? name }));
const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

export function resolveState(s: unknown): State {
  const raw = String(s ?? '').trim();
  if (!raw) throw new InputError('state is required, as a name or a two-letter code such as CA.');
  const up = raw.toUpperCase().replace(/\./g, '');
  const byCode = STATES.find((x) => x.code === up);
  if (byCode) return byCode;
  const k = squash(raw.replace(/^state of /i, ''));
  const alias: Record<string, string> = { washingtondc: 'DC', dc: 'DC', virginislands: 'VI', usvirginislands: 'VI', usvi: 'VI', washingtonstate: 'WA' };
  if (alias[k]) return STATES.find((x) => x.code === alias[k]) as State;
  const byName = STATES.find((x) => squash(x.name) === k || squash(x.wval) === k || squash(x.ari) === k);
  if (byName) return byName;
  throw new InputError(`unknown state "${raw}". Use a US state, DC or territory name or its two-letter code.`);
}

/** SoQL string literal. */
export const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function soda(dataset: string, params: Record<string, string>): string {
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `${BASE}/${dataset}.json?${qs}`;
}

async function rows(f: FetchText, dataset: string, params: Record<string, string>, cacheTtl: number): Promise<Record<string, string>[]> {
  const body = await f(soda(dataset, params), { cacheTtl, timeoutMs: 25000 });
  let data: unknown;
  try { data = JSON.parse(body); } catch { throw new UpstreamError('data.cdc.gov returned something that is not JSON'); }
  if (!Array.isArray(data)) throw new UpstreamError(`data.cdc.gov answered with an error: ${String((data as { message?: string })?.message ?? body).slice(0, 200)}`);
  return data as Record<string, string>[];
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
const day = (s: unknown) => String(s ?? '').slice(0, 10);
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

export function median(xs: number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return r2(v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2);
}

export interface WvalRow { state: string; counties: string; site: string; pop: number; wval: number; category: string; week: string; target: string; updated: string }
export function parseWval(r: Record<string, string>): WvalRow | null {
  const week = day(r.week_end);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || !r.site || !r.pathogen_target) return null;
  const pop = Number(r.population_served);
  const wval = Number(r.site_wval);
  return {
    state: String(r.state_territory ?? ''), counties: String(r.counties_served ?? ''), site: String(r.site), pop: Number.isFinite(pop) ? pop : 0,
    wval: Number.isFinite(wval) ? wval : NaN, category: String(r.site_wval_category ?? ''), week, target: String(r.pathogen_target), updated: String(r.date_updated ?? ''),
  };
}
const WVAL_COLS = 'state_territory,counties_served,site,population_served,site_wval,site_wval_category,week_end,pathogen_target,date_updated';

export async function latestWval(f: FetchText): Promise<{ week_end: string; date_updated: string }> {
  const r = await rows(f, DS.wval, { $select: 'max(week_end) as week_end, max(date_updated) as date_updated' }, 1800);
  const week = day(r[0]?.week_end);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) throw new UpstreamError('data.cdc.gov did not return a latest wastewater week');
  return { week_end: week, date_updated: String(r[0]?.date_updated ?? '') };
}

async function wvalRows(f: FetchText, where: string): Promise<WvalRow[]> {
  const r = await rows(f, DS.wval, { $select: WVAL_COLS, $where: where, $order: 'week_end DESC', $limit: '20000' }, 1800);
  return r.map(parseWval).filter((x): x is WvalRow => x !== null);
}

export interface WeekStat { week_end: string; sites: number; median_site_wval: number | null; share_population_high_or_very_high_pct: number | null }
export interface PathogenSummary {
  pathogen: string; pathogen_id: PathogenId; week_end: string; sites: number; population_served: number;
  site_categories: Record<string, number>; population_by_category: Record<string, number>;
  share_population_high_or_very_high_pct: number | null; median_site_wval: number | null; most_common_category: string | null;
  previous_week: WeekStat | null; change_vs_previous_week: string;
}

function weekStat(rs: WvalRow[], week: string): WeekStat {
  const pop = rs.reduce((s, r) => s + r.pop, 0);
  const high = rs.filter((r) => r.category === 'High' || r.category === 'Very High').reduce((s, r) => s + r.pop, 0);
  return { week_end: week, sites: rs.length, median_site_wval: median(rs.map((r) => r.wval)), share_population_high_or_very_high_pct: pop > 0 ? r1((high / pop) * 100) : null };
}

/** Distribution of CDC site levels for one pathogen in one week, with the week before for comparison. */
export function summarize(all: WvalRow[], p: Pathogen, week: string): PathogenSummary | null {
  const cur = all.filter((r) => r.target === p.target && r.week === week);
  if (!cur.length) return null;
  const prevWeek = addDays(week, -7);
  const prev = all.filter((r) => r.target === p.target && r.week === prevWeek);
  const cats: Record<string, number> = {}; const popCats: Record<string, number> = {};
  for (const c of CATEGORIES) { cats[c] = 0; popCats[c] = 0; }
  for (const r of cur) { cats[r.category] = (cats[r.category] ?? 0) + 1; popCats[r.category] = (popCats[r.category] ?? 0) + r.pop; }
  let mode: string | null = null;
  for (const c of CATEGORIES) if (cats[c] > 0 && (mode === null || cats[c] >= cats[mode])) mode = c;
  const now = weekStat(cur, week);
  const before = prev.length ? weekStat(prev, prevWeek) : null;
  let change = 'no data for the previous week';
  if (before && now.median_site_wval !== null && before.median_site_wval !== null) {
    const d = now.median_site_wval - before.median_site_wval;
    change = Math.abs(d) < 0.25 ? 'about the same' : d > 0 ? 'up' : 'down';
  }
  return {
    pathogen: p.name, pathogen_id: p.id, week_end: week, sites: cur.length, population_served: cur.reduce((s, r) => s + r.pop, 0),
    site_categories: cats, population_by_category: popCats, share_population_high_or_very_high_pct: now.share_population_high_or_very_high_pct,
    median_site_wval: now.median_site_wval, most_common_category: mode, previous_week: before, change_vs_previous_week: change,
  };
}

export function describe(s: PathogenSummary): string {
  const cats = [...CATEGORIES].reverse().filter((c) => s.site_categories[c] > 0).map((c) => `${c} ${s.site_categories[c]}`).join(', ');
  const prev = s.previous_week?.median_site_wval;
  return `${s.pathogen}: ${s.sites} site${s.sites === 1 ? '' : 's'} (${cats}); ${s.share_population_high_or_very_high_pct ?? 0}% of people served are at sites rated High or Very High; ` +
    `median site level ${s.median_site_wval ?? 'n/a'}${prev !== undefined && prev !== null ? ` (${s.change_vs_previous_week} from ${prev} the week before)` : ''}`;
}

export interface Ari { week_end: string; label: string; percent_visits_ari: number | null; previous: { week_end: string; label: string; percent_visits_ari: number | null } | null }
function parseAri(list: Record<string, string>[]): Ari | null {
  const sorted = [...list].sort((a, b) => day(b.week_end).localeCompare(day(a.week_end)));
  if (!sorted.length) return null;
  const one = (r: Record<string, string>) => {
    const pct = Number(r.percent_visits_ari);
    return { week_end: day(r.week_end), label: String(r.label ?? 'Data Unavailable'), percent_visits_ari: r.percent_visits_ari !== undefined && Number.isFinite(pct) ? pct : null };
  };
  return { ...one(sorted[0]), previous: sorted[1] ? one(sorted[1]) : null };
}
const ariText = (a: Ari | null, where: string) => a
  ? `Emergency department visits for acute respiratory illness in ${where}: ${a.label}${a.percent_visits_ari !== null ? ` (${a.percent_visits_ari}% of visits)` : ''}, week ending ${a.week_end}` +
    (a.previous ? `; the week before ${a.previous.label}${a.previous.percent_visits_ari !== null ? ` (${a.previous.percent_visits_ari}%)` : ''}.` : '.')
  : `No CDC acute respiratory illness activity level for ${where}.`;

const NOTES = [
  'Site levels are CDC wastewater viral activity levels (WVAL) for each sewershed. CDC does not publish one official level per state in this dataset; this shows how the sites in the state are distributed.',
  'Wastewater measures virus shed into sewers by everyone in the area, including people without symptoms. It is not a case count. Not medical advice.',
  'Population served is summed across reporting sites; nested sewersheds can overlap.',
];

// ---------------------------------------------------------------------------------------------------------------- tools

export async function stateLevels(f: FetchText, a: { state: string; pathogen?: string }) {
  const st = resolveState(a.state);
  const ps = pathogensOf(a.pathogen);
  const latest = await latestWval(f);
  const since = addDays(latest.week_end, -35);
  const [all, ariRows] = await Promise.all([
    wvalRows(f, `state_territory=${q(st.wval)} AND week_end >= ${q(since)}`),
    rows(f, DS.ari, { $where: `geography=${q(st.ari)}`, $order: 'week_end DESC', $limit: '4' }, 1800),
  ]);
  const ari = parseAri(ariRows);
  const week = all.reduce((m, r) => (r.week > m ? r.week : m), '');
  const updated = all.reduce((m, r) => (r.updated > m ? r.updated : m), '');
  const pathogens = week ? ps.map((p) => summarize(all, p, week)).filter((x): x is PathogenSummary => x !== null) : [];
  const weeks = [...new Set(all.map((r) => r.week))].sort().reverse();
  const trend = ps.map((p) => ({
    pathogen: p.name,
    weeks: weeks.map((w) => weekStat(all.filter((r) => r.target === p.target && r.week === w), w)).filter((x) => x.sites > 0),
  }));
  const head = week
    ? `${st.name}, CDC wastewater levels for the week ending ${week}${week < latest.week_end ? ` (the newest national week is ${latest.week_end}; this state has not reported it yet)` : ''}. These are the levels of the state's sewershed sites, not one official state level.`
    : `${st.name}: no CDC wastewater site reported COVID-19, flu or RSV levels in the 6 weeks to ${latest.week_end}.`;
  const summary = [head, ...pathogens.map(describe), ariText(ari, st.name)].join('\n');
  return {
    summary, state: st.name, state_code: st.code, week_end: week || null, pathogens, trend_last_6_weeks: trend, ari_emergency_department: ari,
    as_of: { wastewater_week_end: week || null, latest_national_week_end: latest.week_end, date_updated: updated || latest.date_updated, ari_week_end: ari?.week_end ?? null },
    notes: NOTES, source: SOURCE, more: more(),
  };
}

/**
 * County name as CDC writes it in counties_served: no apostrophes or accents, "Saint" spelled out
 * ("Prince Georges", "Dona Ana", "Saint Louis"). Applied to both the caller's input and the data.
 */
export const normCounty = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['\u2019.]/g, '').replace(/\s+/g, ' ').trim()
  .replace(/^st\s+/, 'saint ').replace(/^ste\s+/, 'sainte ')
  .replace(/\s+(county|parish|borough|census area|city and borough|municipality)$/, '').trim();
/** Longest word of the normalized county, for a broad LIKE pre-filter on data.cdc.gov; the exact match is done locally. */
export const countyLikeWord = (norm: string) => norm.split(' ').reduce((m, w) => (w.length > m.length ? w : m), '').replace(/[^a-z-]/g, '').toUpperCase();

export async function countyLevels(f: FetchText, a: { county: string; state: string; weeks?: number; pathogen?: string }) {
  const st = resolveState(a.state);
  const ps = pathogensOf(a.pathogen);
  const county = normCounty(String(a.county ?? ''));
  const like = countyLikeWord(county);
  if (like.length < 2) throw new InputError('county is required, for example "Cook" or "Los Angeles County".');
  const weeks = Math.min(12, Math.max(1, Math.round(a.weeks ?? 6)));
  const latest = await latestWval(f);
  const since = addDays(latest.week_end, -7 * (weeks - 1));
  const found = await wvalRows(f, `state_territory=${q(st.wval)} AND upper(counties_served) like ${q(`%${like}%`)} AND week_end >= ${q(since)}`);
  const mine = found.filter((r) => r.counties.split(',').map(normCounty).includes(county));
  const given = a.county.trim().replace(/\s+/g, ' ');
  const label = `${/\s(county|parish|borough|census area|municipality)$/i.test(given) ? given : `${given} County`}, ${st.name}`;
  if (!mine.length) {
    const list = await rows(f, DS.wval, { $select: 'counties_served', $where: `state_territory=${q(st.wval)} AND week_end >= ${q(since)}`, $group: 'counties_served', $limit: '2000' }, 1800);
    const counties = [...new Set(list.flatMap((r) => String(r.counties_served ?? '').split(',').map((c) => c.trim()).filter(Boolean)))].sort();
    return {
      summary: `CDC lists no wastewater site serving ${label} in the ${weeks} weeks to ${latest.week_end}. ` +
        (counties.length ? `Counties in ${st.name} with at least one site: ${counties.slice(0, 60).join(', ')}${counties.length > 60 ? ` and ${counties.length - 60} more` : ''}. Try covid_flu_rsv_levels_state for the whole state.` : `No site in ${st.name} reported in that period.`),
      county: label, state: st.name, sites: [], counties_with_sites: counties,
      as_of: { latest_national_week_end: latest.week_end, date_updated: latest.date_updated }, notes: NOTES, source: SOURCE, more: more(),
    };
  }
  const week = mine.reduce((m, r) => (r.week > m ? r.week : m), '');
  const updated = mine.reduce((m, r) => (r.updated > m ? r.updated : m), '');
  const bySite = new Map<string, WvalRow[]>();
  for (const r of mine) { const l = bySite.get(r.site) ?? []; l.push(r); bySite.set(r.site, l); }
  const sites = [...bySite.entries()].map(([site, rs]) => {
    const pop = Math.max(...rs.map((r) => r.pop));
    const levels = ps.map((p) => {
      const series = rs.filter((r) => r.target === p.target).sort((x, y) => y.week.localeCompare(x.week))
        .map((r) => ({ week_end: r.week, site_wval: Number.isFinite(r.wval) ? r2(r.wval) : null, category: r.category }));
      return { pathogen: p.name, latest: series[0] ?? null, trend: series };
    });
    return { site, counties_served: rs[0].counties, population_served: pop, levels };
  }).sort((x, y) => y.population_served - x.population_served);
  const pathogens = ps.map((p) => summarize(mine, p, week)).filter((x): x is PathogenSummary => x !== null);
  const siteLine = (s: (typeof sites)[number]) => `Site ${s.site} (${fmtInt(s.population_served)} people; counties ${s.counties_served}): ` +
    s.levels.map((l) => l.latest ? `${l.pathogen} ${l.latest.category} ${l.latest.site_wval ?? ''}${l.latest.week_end !== week ? ` (week ending ${l.latest.week_end})` : ''}${l.trend[1] ? `, was ${l.trend[1].category} ${l.trend[1].site_wval ?? ''}` : ''}` : `${l.pathogen} not reported`).join('; ');
  const summary = [
    `${label}: ${sites.length} CDC wastewater site${sites.length === 1 ? '' : 's'} serving the county, week ending ${week}.`,
    ...pathogens.map(describe),
    ...sites.slice(0, 5).map(siteLine),
    sites.length > 5 ? `${sites.length - 5} more sites in the structured result.` : '',
  ].filter(Boolean).join('\n');
  return {
    summary, county: label, state: st.name, week_end: week, sites_count: sites.length, pathogens, sites: sites.slice(0, 30),
    as_of: { wastewater_week_end: week, latest_national_week_end: latest.week_end, date_updated: updated || latest.date_updated },
    notes: NOTES, source: SOURCE, more: more(),
  };
}

export async function nationalLevels(f: FetchText, a: { weeks?: number }) {
  const weeks = Math.min(52, Math.max(1, Math.round(a.weeks ?? 8)));
  const latest = await latestWval(f);
  const [pos, ari, dist] = await Promise.all([
    rows(f, DS.positivity, { $order: 'week_end DESC', $limit: String(weeks * 3 + 6) }, 1800),
    rows(f, DS.ari, { $order: 'week_end DESC', $limit: '120' }, 1800),
    rows(f, DS.wval, {
      $select: 'pathogen_target,site_wval_category,count(*) as sites,sum(population_served) as pop', $where: `week_end=${q(latest.week_end)}`,
      $group: 'pathogen_target,site_wval_category', $limit: '100',
    }, 1800),
  ]);
  const posWeeks = [...new Set(pos.map((r) => day(r.week_end)))].sort().reverse().slice(0, weeks);
  if (!posWeeks.length) throw new UpstreamError('data.cdc.gov returned no test positivity rows');
  const positivity = PATHOGENS.map((p) => {
    const series = posWeeks.map((w) => {
      const r = pos.find((x) => day(x.week_end) === w && x.pathogen === p.positivity);
      const v = r ? Number(r.percent_test_positivity) : NaN;
      return { week_end: w, percent_test_positivity: Number.isFinite(v) ? v : null };
    });
    const vals = series.filter((s) => s.percent_test_positivity !== null) as { week_end: string; percent_test_positivity: number }[];
    const peak = vals.reduce<{ week_end: string; percent_test_positivity: number } | null>((m, s) => (m === null || s.percent_test_positivity > m.percent_test_positivity ? s : m), null);
    const now = series[0]?.percent_test_positivity ?? null; const prev = series[1]?.percent_test_positivity ?? null;
    return { pathogen: p.name, latest: now, previous_week: prev, change_points: now !== null && prev !== null ? r1(now - prev) : null, peak_in_window: peak, weeks: series };
  });
  const ariWeek = ari.reduce((m, r) => (day(r.week_end) > m ? day(r.week_end) : m), '');
  const ariNow = ari.filter((r) => day(r.week_end) === ariWeek);
  const us = ariNow.find((r) => r.geography === 'United States');
  const rank = (l: string) => ARI_ORDER.indexOf(l);
  const statesRanked = ariNow.filter((r) => r.geography !== 'United States' && rank(r.label) >= 0)
    .map((r) => ({ state: r.geography, label: r.label, percent_visits_ari: Number.isFinite(Number(r.percent_visits_ari)) ? Number(r.percent_visits_ari) : null }))
    .sort((x, y) => rank(y.label) - rank(x.label) || (y.percent_visits_ari ?? 0) - (x.percent_visits_ari ?? 0));
  const ariCounts: Record<string, number> = {};
  for (const r of ariNow) if (r.geography !== 'United States') ariCounts[r.label] = (ariCounts[r.label] ?? 0) + 1;
  const wastewater = PATHOGENS.map((p) => {
    const rs = dist.filter((r) => r.pathogen_target === p.target);
    const cats: Record<string, number> = {}; let pop = 0; let high = 0; let sites = 0;
    for (const c of CATEGORIES) cats[c] = 0;
    for (const r of rs) {
      const n = Number(r.sites) || 0; const pp = Number(r.pop) || 0;
      cats[r.site_wval_category] = (cats[r.site_wval_category] ?? 0) + n; sites += n; pop += pp;
      if (r.site_wval_category === 'High' || r.site_wval_category === 'Very High') high += pp;
    }
    return { pathogen: p.name, week_end: latest.week_end, sites, population_served: pop, site_categories: cats, share_population_high_or_very_high_pct: pop > 0 ? r1((high / pop) * 100) : null };
  });
  const summary = [
    `United States, week ending ${posWeeks[0]}. Percent of tests positive: ` +
      positivity.map((p) => `${p.pathogen} ${p.latest ?? 'n/a'}%${p.previous_week !== null ? ` (${p.previous_week}% the week before)` : ''}`).join(', ') + '.',
    `Wastewater, week ending ${latest.week_end}: ` + wastewater.map((w) => `${w.pathogen} ${w.share_population_high_or_very_high_pct ?? 0}% of people served live in sewersheds rated High or Very High (${w.sites} sites)`).join('; ') + '.',
    us ? `Emergency department respiratory illness activity, week ending ${ariWeek}: United States ${us.label}${us.percent_visits_ari !== undefined ? ` (${us.percent_visits_ari}% of visits)` : ''}. ` +
      `Highest: ${statesRanked.slice(0, 5).map((s) => `${s.state} ${s.label} ${s.percent_visits_ari ?? ''}%`).join(', ')}.` : '',
  ].filter(Boolean).join('\n');
  return {
    summary, test_positivity: positivity, wastewater, ari_emergency_department: { week_end: ariWeek, united_states: us ? { label: us.label, percent_visits_ari: Number.isFinite(Number(us.percent_visits_ari)) && us.percent_visits_ari !== undefined ? Number(us.percent_visits_ari) : null } : null, states_by_level: ariCounts, highest_states: statesRanked.slice(0, 10) },
    as_of: { test_positivity_week_end: posWeeks[0], wastewater_week_end: latest.week_end, ari_week_end: ariWeek, date_updated: latest.date_updated },
    notes: ['Test positivity is the national share of laboratory tests that were positive (NREVSS and flu collaborating labs), not the share of people infected.', ...NOTES.slice(1, 2)],
    source: SOURCE, more: more(),
  };
}

export async function compareStates(f: FetchText, a: { states: string[]; pathogen?: string }) {
  if (!Array.isArray(a.states) || a.states.length < 2) throw new InputError('give 2 to 10 states.');
  const list: State[] = [];
  for (const s of a.states) { const st = resolveState(s); if (!list.some((x) => x.code === st.code)) list.push(st); }
  if (list.length < 2 || list.length > 10) throw new InputError('give 2 to 10 different states.');
  const ps = pathogensOf(a.pathogen);
  const latest = await latestWval(f);
  // Three weeks, so a state that has not yet reported the newest national week is shown at its own newest week.
  const since = addDays(latest.week_end, -14);
  const [all, ari] = await Promise.all([
    wvalRows(f, `state_territory in (${list.map((s) => q(s.wval)).join(',')}) AND week_end >= ${q(since)}`),
    rows(f, DS.ari, { $where: `geography in (${list.map((s) => q(s.ari)).join(',')})`, $order: 'week_end DESC', $limit: String(list.length * 4) }, 1800),
  ]);
  const states = list.map((st) => {
    const rs = all.filter((r) => r.state === st.wval);
    const week = rs.reduce((m, r) => (r.week > m ? r.week : m), '');
    const pathogens = week ? ps.map((p) => summarize(rs, p, week)).filter((x): x is PathogenSummary => x !== null) : [];
    const ar = parseAri(ari.filter((r) => r.geography === st.ari));
    return { state: st.name, state_code: st.code, week_end: week || null, pathogens, ari_emergency_department: ar };
  });
  const ranking = ps.map((p) => ({
    pathogen: p.name,
    by_share_high: states.map((s) => ({ state: s.state, share: s.pathogens.find((x) => x.pathogen_id === p.id)?.share_population_high_or_very_high_pct ?? null, median: s.pathogens.find((x) => x.pathogen_id === p.id)?.median_site_wval ?? null }))
      .sort((x, y) => (y.share ?? -1) - (x.share ?? -1) || (y.median ?? -1) - (x.median ?? -1)),
  }));
  const line = (s: (typeof states)[number]) => `${s.state}: ` + (s.pathogens.length
    ? s.pathogens.map((p) => `${p.pathogen} ${p.share_population_high_or_very_high_pct ?? 0}% High or Very High, median ${p.median_site_wval ?? 'n/a'} (${p.sites} sites)`).join('; ') +
      (s.week_end && s.week_end < latest.week_end ? ` (week ending ${s.week_end}, the newest this state has reported)` : '')
    : `no wastewater sites reported in the 3 weeks to ${latest.week_end}`) +
    (s.ari_emergency_department ? `; ER respiratory activity ${s.ari_emergency_department.label}${s.ari_emergency_department.percent_visits_ari !== null ? ` ${s.ari_emergency_department.percent_visits_ari}%` : ''}` : '');
  const summary = [`CDC wastewater levels, week ending ${latest.week_end} ("% High or Very High" is the share of people served by sites at those levels):`, ...states.map(line),
    ...ranking.map((r) => `Highest ${r.pathogen}: ${r.by_share_high.filter((x) => x.share !== null).slice(0, 3).map((x) => `${x.state} ${x.share}%`).join(', ') || 'no data'}`)].join('\n');
  return {
    summary, week_end: latest.week_end, states, ranking,
    as_of: { wastewater_week_end: latest.week_end, date_updated: latest.date_updated, ari_week_end: states.find((s) => s.ari_emergency_department)?.ari_emergency_department?.week_end ?? null },
    notes: NOTES, source: SOURCE, more: more(),
  };
}
