// Fixtures in test/fixtures/ are data.cdc.gov answers downloaded 2026-11-17T08:54Z:
//   latest.json                 atcp-73re max(week_end) 2026-11-07, date_updated 2026-11-13 11:02
//   wval-vt-nh-ok.json          atcp-73re rows for Vermont, New Hampshire and Oklahoma, week_end >= 2026-10-03 (525 rows)
//   national-distribution.json  atcp-73re site counts and population by pathogen and category, week 2026-11-07
//   ari.json                    f3zz-zga5 all geographies, week_end >= 2026-10-17
//   positivity.json             seuz-s2cv newest 30 rows
// Expected values were computed from those files with a separate Python script: Vermont week 2026-11-07 COVID 11 sites
// (Very High 6, Moderate 3, Low 2), 47.1% of people served at High or Very High, median 13.27 (11.14 the week before, so up);
// Chittenden County 4 sites, 81,000 people; Oklahoma's newest week is 2026-10-31 (one week behind the national 2026-11-07);
// national test positivity COVID-19 3.2, Influenza 11.3, RSV 1.6 (3.7, 10.1, 1.1 the week before); wastewater share High or
// Very High COVID 44.0% of 935 sites, flu 20.2% of 840, RSV 6.1% of 799; ARI United States Low 12.66%.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import {
  resolveState, pathogensOf, normCounty, countyLikeWord, median, addDays, soda,
  stateLevels, countyLevels, nationalLevels, compareStates, InputError, UpstreamError, UTM,
} from '../dist/core.js';

const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const WVAL = fx('wval-vt-nh-ok.json');
const ARI = fx('ari.json');
const seen = [];

// A small evaluator for the SoQL $where clauses core.ts builds, applied to the fixture rows.
function where(rows, w) {
  if (!w) return rows;
  const parts = w.split(' AND ');
  return rows.filter((r) => parts.every((p) => {
    let m;
    if ((m = /^(\w+)=('(?:[^']|'')*')$/.exec(p))) return r[m[1]] === m[2].slice(1, -1).replace(/''/g, "'");
    if ((m = /^(\w+) in \((.+)\)$/.exec(p))) return m[2].split(',').map((x) => x.trim().slice(1, -1)).includes(r[m[1]]);
    if ((m = /^(\w+) >= '(.+)'$/.exec(p))) return String(r[m[1]]) >= m[2];
    if ((m = /^upper\((\w+)\) like '%(.+)%'$/.exec(p))) return String(r[m[1]]).toUpperCase().includes(m[2]);
    throw new Error(`test evaluator: unsupported clause ${p}`);
  }));
}
const desc = (rows) => [...rows].sort((a, b) => String(b.week_end).localeCompare(String(a.week_end)));

const f = async (u) => {
  seen.push(u);
  const url = new URL(u);
  const P = Object.fromEntries(url.searchParams.entries());
  const lim = Number(P.$limit ?? 1000);
  if (url.pathname === '/resource/atcp-73re.json') {
    if (P.$select?.startsWith('max(')) return JSON.stringify(fx('latest.json'));
    if (P.$group === 'pathogen_target,site_wval_category') return JSON.stringify(fx('national-distribution.json'));
    const rs = where(WVAL, P.$where);
    if (P.$group === 'counties_served') return JSON.stringify([...new Set(rs.map((r) => r.counties_served))].map((c) => ({ counties_served: c })));
    return JSON.stringify(desc(rs).slice(0, lim));
  }
  if (url.pathname === '/resource/f3zz-zga5.json') return JSON.stringify(desc(where(ARI, P.$where)).slice(0, lim));
  if (url.pathname === '/resource/seuz-s2cv.json') return JSON.stringify(fx('positivity.json').slice(0, lim));
  throw new Error(`HTTP 404 (no fixture for ${u})`);
};

test('states, pathogens, county names and helpers', () => {
  assert.equal(resolveState('vt').name, 'Vermont'); assert.equal(resolveState('New Hampshire').code, 'NH'); assert.equal(resolveState('Washington DC').code, 'DC');
  assert.equal(resolveState('USVI').wval, 'U.S. Virgin Islands'); assert.equal(resolveState('Virgin Islands').ari, 'Virgin Islands');
  assert.throws(() => resolveState('Narnia'), InputError);
  assert.deepEqual(pathogensOf('COVID-19').map((p) => p.id), ['covid']); assert.deepEqual(pathogensOf(undefined).map((p) => p.id), ['covid', 'flu', 'rsv']);
  assert.deepEqual(pathogensOf('influenza').map((p) => p.target), ['Influenza A virus']); assert.throws(() => pathogensOf('measles'), InputError);
  assert.equal(normCounty('St. Louis County'), 'saint louis'); assert.equal(normCounty("Prince George's"), 'prince georges'); assert.equal(normCounty('Doña Ana County'), 'dona ana');
  assert.equal(normCounty('Orleans Parish'), 'orleans'); assert.equal(normCounty('Saint Louis City'), 'saint louis city'); assert.equal(countyLikeWord('prince georges'), 'GEORGES');
  assert.equal(median([3, 1, 2]), 2); assert.equal(median([1, 2, 3, 4]), 2.5); assert.equal(median([]), null); assert.equal(addDays('2026-11-07', -35), '2026-10-03');
  assert.equal(soda('atcp-73re', { $where: "state_territory='Vermont'" }), 'https://data.cdc.gov/resource/atcp-73re.json?$where=state_territory%3D\'Vermont\'');
});

test('state levels: Vermont week ending 2026-11-07, COVID up, flu down, ARI Very Low', async () => {
  const r = await stateLevels(f, { state: 'VT' });
  assert.equal(r.state, 'Vermont'); assert.equal(r.week_end, '2026-11-07'); assert.equal(r.pathogens.length, 3);
  const [c, fl, rsv] = r.pathogens;
  assert.equal(c.sites, 11); assert.deepEqual(c.site_categories, { 'Very Low': 0, Low: 2, Moderate: 3, High: 0, 'Very High': 6 });
  assert.equal(c.share_population_high_or_very_high_pct, 47.1); assert.equal(c.median_site_wval, 13.27); assert.equal(c.previous_week.median_site_wval, 11.14);
  assert.equal(c.change_vs_previous_week, 'up'); assert.equal(c.population_served, 129700); assert.equal(c.most_common_category, 'Very High');
  assert.equal(fl.median_site_wval, 1); assert.equal(fl.change_vs_previous_week, 'down'); assert.equal(fl.share_population_high_or_very_high_pct, 7.4);
  assert.equal(rsv.change_vs_previous_week, 'about the same');
  assert.equal(r.ari_emergency_department.label, 'Very Low'); assert.equal(r.ari_emergency_department.percent_visits_ari, 7.4); assert.equal(r.ari_emergency_department.week_end, '2026-11-07');
  assert.equal(r.trend_last_6_weeks[0].weeks.length, 6);
  assert.match(r.summary, /^Vermont, CDC wastewater levels for the week ending 2026-11-07\./);
  assert.match(r.summary, /COVID-19: 11 sites \(Very High 6, Moderate 3, Low 2\); 47\.1% of people served are at sites rated High or Very High; median site level 13\.27 \(up from 11\.14 the week before\)/);
  assert.ok(r.more.includes(UTM));
});

test('state levels: Oklahoma lags one week and says so', async () => {
  const r = await stateLevels(f, { state: 'Oklahoma', pathogen: 'covid' });
  assert.equal(r.week_end, '2026-10-31'); assert.equal(r.pathogens.length, 1); assert.equal(r.pathogens[0].sites, 8); assert.equal(r.pathogens[0].change_vs_previous_week, 'down');
  assert.match(r.summary, /the newest national week is 2026-11-07; this state has not reported it yet/);
});

test('county levels: Chittenden County, Vermont, 4 sites; unknown county lists the counties with sites', async () => {
  const r = await countyLevels(f, { county: 'Chittenden County', state: 'Vermont' });
  assert.equal(r.county, 'Chittenden County, Vermont'); assert.equal(r.sites_count, 4); assert.equal(r.week_end, '2026-11-07');
  assert.deepEqual(r.sites.map((s) => [s.site, s.population_served]), [['ID:1965', 30000], ['ID:1967', 25000], ['ID:1966', 16000], ['ID:2782', 10000]]);
  const s1967 = r.sites.find((s) => s.site === 'ID:1967');
  assert.deepEqual(s1967.levels[0].latest, { week_end: '2026-11-07', site_wval: 20.37, category: 'Very High' });
  assert.deepEqual(s1967.levels[1].trend[1], { week_end: '2026-10-31', site_wval: 37.88, category: 'Very High' });
  assert.equal(s1967.levels[0].trend.length, 6);
  assert.equal(r.pathogens[0].share_population_high_or_very_high_pct, 43.2); assert.equal(r.pathogens[0].median_site_wval, 14.06);
  assert.match(r.summary, /Site ID:1967 \(25,000 people; counties Chittenden\): COVID-19 Very High 20\.37, was High 10\.38/);
  const none = await countyLevels(f, { county: 'Essex', state: 'VT' });
  assert.equal(none.sites.length, 0); assert.deepEqual(none.counties_with_sites, ['Addison', 'Caledonia', 'Chittenden', 'Franklin', 'Washington', 'Windham', 'Windsor']);
  assert.match(none.summary, /^CDC lists no wastewater site serving Essex County, Vermont/);
});

test('national levels: test positivity, wastewater shares and ARI', async () => {
  const r = await nationalLevels(f, { weeks: 2 });
  assert.deepEqual(r.test_positivity.map((p) => [p.pathogen, p.latest, p.previous_week, p.change_points]), [
    ['COVID-19', 3.2, 3.7, -0.5], ['Flu (influenza A)', 11.3, 10.1, 1.2], ['RSV', 1.6, 1.1, 0.5],
  ]);
  assert.deepEqual(r.wastewater.map((w) => [w.sites, w.share_population_high_or_very_high_pct]), [[935, 44], [840, 20.2], [799, 6.1]]);
  assert.equal(r.ari_emergency_department.week_end, '2026-11-07'); assert.deepEqual(r.ari_emergency_department.united_states, { label: 'Low', percent_visits_ari: 12.66 });
  assert.deepEqual(r.ari_emergency_department.highest_states.slice(0, 5).map((s) => s.state), ['Hawaii', 'Texas', 'Florida', 'Wyoming', 'Alabama']);
  assert.equal(r.as_of.test_positivity_week_end, '2026-11-07');
  assert.match(r.summary, /^United States, week ending 2026-11-07\. Percent of tests positive: COVID-19 3\.2% \(3\.7% the week before\), Flu \(influenza A\) 11\.3% \(10\.1% the week before\), RSV 1\.6%/);
});

test('compare states: each state at its own newest week, ranked by share High or Very High', async () => {
  const r = await compareStates(f, { states: ['VT', 'New Hampshire', 'OK'], pathogen: 'covid' });
  assert.equal(r.week_end, '2026-11-07');
  assert.deepEqual(r.states.map((s) => [s.state_code, s.week_end, s.pathogens[0].sites]), [['VT', '2026-11-07', 11], ['NH', '2026-11-07', 4], ['OK', '2026-10-31', 8]]);
  assert.deepEqual(r.ranking[0].by_share_high.map((x) => [x.state, x.share]), [['Vermont', 47.1], ['New Hampshire', 22.7], ['Oklahoma', 0]]);
  assert.match(r.summary, /Oklahoma: COVID-19 0% High or Very High, median 1 \(8 sites\) \(week ending 2026-10-31, the newest this state has reported\)/);
});

test('input errors and upstream errors', async () => {
  await assert.rejects(compareStates(f, { states: ['VT'] }), InputError);
  await assert.rejects(compareStates(f, { states: ['VT', 'Vermont'] }), InputError);
  await assert.rejects(countyLevels(f, { county: '1', state: 'VT' }), InputError);
  await assert.rejects(stateLevels(f, { state: 'XX' }), InputError);
  await assert.rejects(stateLevels(async () => '<html>', { state: 'VT' }), UpstreamError);
  await assert.rejects(stateLevels(async () => '{"message":"bad query"}', { state: 'VT' }), UpstreamError);
});

test('stdio: initialize, tools/list with annotations and a tools/call error over JSON-RPC (offline)', async () => {
  const child = spawn(process.execPath, [new URL('../dist/stdio.js', import.meta.url).pathname], { stdio: ['pipe', 'pipe', 'ignore'] });
  const lines = []; let buf = '';
  const got = (id) => new Promise((res) => { const iv = setInterval(() => { const m = lines.find((l) => l.id === id); if (m) { clearInterval(iv); res(m); } }, 10); });
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  const send = (m) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  assert.equal((await got(1)).result.serverInfo.name, 'covid-flu-rsv-wastewater-levels-mcp');
  send({ method: 'notifications/initialized' });
  send({ id: 2, method: 'tools/list' });
  const tools = (await got(2)).result.tools;
  assert.deepEqual(tools.map((t) => t.name), ['covid_flu_rsv_levels_state', 'covid_flu_rsv_levels_county', 'covid_flu_rsv_levels_national', 'covid_flu_rsv_compare_states']);
  for (const t of tools) { assert.ok(t.title); assert.equal(t.annotations.readOnlyHint, true); assert.equal(t.annotations.destructiveHint, false); assert.equal(t.annotations.openWorldHint, true); }
  send({ id: 3, method: 'tools/call', params: { name: 'covid_flu_rsv_levels_state', arguments: { state: 'Narnia' } } });
  const r3 = await got(3);
  child.kill();
  assert.equal(r3.result?.isError ?? Boolean(r3.error), true);
});
