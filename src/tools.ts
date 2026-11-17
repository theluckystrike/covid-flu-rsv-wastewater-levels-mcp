// Tool registry shared by the stdio and Worker entries.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { InputError, REPO, SITE, compareStates, countyLevels, nationalLevels, stateLevels } from './core.js';
import type { FetchText } from './types.js';

export const VERSION = '1.0.0';

export const META = {
  alias: 'covid-flu-rsv-levels',
  metaDescription: 'MCP server for COVID, flu and RSV levels: CDC wastewater viral activity levels by state and county, emergency department respiratory illness activity by state and national test positivity, read live from data.cdc.gov.',
  intro: 'COVID-19, flu and RSV levels for AI assistants, read live from CDC wastewater surveillance, emergency department and laboratory data.',
};

export const TOOL_INFO = [
  { name: 'covid_flu_rsv_levels_state', blurb: 'CDC wastewater levels of COVID-19, flu and RSV in one state this week: how the sewershed sites are rated, the median level, the change from last week, and emergency department respiratory illness activity.' },
  { name: 'covid_flu_rsv_levels_county', blurb: 'Wastewater levels at each CDC sewershed site that serves a county, with the last weeks of COVID-19, flu and RSV readings per site.' },
  { name: 'covid_flu_rsv_levels_national', blurb: 'United States: percent of tests positive for COVID-19, flu and RSV, the share of people in sewersheds rated High or Very High, and the states with the most emergency department respiratory illness.' },
  { name: 'covid_flu_rsv_compare_states', blurb: 'Compare COVID-19, flu and RSV wastewater levels across 2 to 10 states, ranked by the share of people served by sites rated High or Very High.' },
];

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

function ok(data: Record<string, unknown> & { summary: string }) {
  return { content: [{ type: 'text' as const, text: `${data.summary}\n\n${JSON.stringify(data, null, 2)}` }], structuredContent: data };
}
function fail(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: 'text' as const, text: `${e instanceof InputError ? 'Error' : 'Upstream CDC (data.cdc.gov) error'}: ${msg}` }] };
}
const wrap = <A>(fn: (a: A) => unknown) => async (a: A) => { try { return ok((await fn(a)) as any); } catch (e) { return fail(e); } };
const pathogen = z.enum(['all', 'covid', 'flu', 'rsv']).optional().describe('covid (SARS-CoV-2), flu (influenza A), rsv, or all. Default all.');

export function createServer(fetchText: FetchText): McpServer {
  const server = new McpServer({ name: REPO, version: VERSION, websiteUrl: SITE } as any, {
    instructions:
      'COVID-19, flu (influenza A) and RSV activity in the United States, read at call time from CDC open data on data.cdc.gov: National Wastewater Surveillance System ' +
      'viral activity levels for each sewershed site (Very Low to Very High), emergency department visits for acute respiratory illness by state, and the national percent of tests positive. ' +
      'CDC updates them weekly, usually on Fridays, for the week that ended the Saturday before. A model cannot know this week\'s levels. ' +
      'Use covid_flu_rsv_levels_state for "is COVID going around in Ohio" or "flu levels in Texas", covid_flu_rsv_levels_county for a county or city area, ' +
      'covid_flu_rsv_levels_national for the US picture, and covid_flu_rsv_compare_states before travel. Wastewater levels are not case counts. Not medical advice.',
  });

  server.registerTool('covid_flu_rsv_levels_state', {
    title: 'COVID, flu and RSV levels in a state',
    description:
      'CDC wastewater viral activity levels for COVID-19, flu (influenza A) and RSV in one US state, DC or territory for the latest week: how many sewershed sites are ' +
      'Very Low, Low, Moderate, High or Very High, the share of people served by High or Very High sites, the median site level and the change from the week before, ' +
      'a 6-week trend, and the state\'s emergency department acute respiratory illness level.',
    inputSchema: {
      state: z.string().min(2).max(40).describe('State name or two-letter code, e.g. "Ohio" or "OH". DC, Puerto Rico and territories also work.'),
      pathogen,
    },
    annotations: { title: 'COVID, flu and RSV levels by state', ...RO },
  }, wrap((a: any) => stateLevels(fetchText, a)));

  server.registerTool('covid_flu_rsv_levels_county', {
    title: 'COVID, flu and RSV wastewater levels in a county',
    description:
      'Wastewater levels for COVID-19, flu and RSV at every CDC sewershed site that serves a county: each site\'s level and category for the latest week, the readings for ' +
      'the last weeks (default 6, up to 12) and the population served. If no site serves the county, lists the counties in the state that have one.',
    inputSchema: {
      county: z.string().min(2).max(60).describe('County name, e.g. "Cook", "Los Angeles County", "St. Louis" or "Orleans Parish".'),
      state: z.string().min(2).max(40).describe('State name or two-letter code.'),
      weeks: z.number().int().min(1).max(12).optional().describe('Weeks of history per site. Default 6.'),
      pathogen,
    },
    annotations: { title: 'Wastewater levels by county', ...RO },
  }, wrap((a: any) => countyLevels(fetchText, a)));

  server.registerTool('covid_flu_rsv_levels_national', {
    title: 'COVID, flu and RSV levels in the US',
    description:
      'The United States picture this week: the percent of laboratory tests positive for COVID-19, influenza and RSV with the weekly trend (default 8 weeks, up to 52), ' +
      'the share of people in sewersheds rated High or Very High for each virus, and emergency department acute respiratory illness activity with the highest states.',
    inputSchema: { weeks: z.number().int().min(1).max(52).optional().describe('Weeks of test positivity history. Default 8.') },
    annotations: { title: 'National COVID, flu and RSV levels', ...RO },
  }, wrap((a: any) => nationalLevels(fetchText, a ?? {})));

  server.registerTool('covid_flu_rsv_compare_states', {
    title: 'Compare COVID, flu and RSV levels between states',
    description:
      'Compare COVID-19, flu and RSV wastewater levels across 2 to 10 states for the latest week each state has reported, ranked by the share of people served by ' +
      'sites rated High or Very High, with each state\'s median site level and emergency department respiratory illness level.',
    inputSchema: {
      states: z.array(z.string().min(2).max(40)).min(2).max(10).describe('2 to 10 state names or two-letter codes.'),
      pathogen,
    },
    annotations: { title: 'Compare states', ...RO },
  }, wrap((a: any) => compareStates(fetchText, a)));

  return server;
}
