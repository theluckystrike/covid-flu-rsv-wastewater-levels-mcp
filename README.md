# covid-flu-rsv-wastewater-levels-mcp

**This week's CDC wastewater levels of COVID-19, flu and RSV by state and county, plus ER respiratory activity and test positivity, as an MCP server.** Free and hosted: no API key, no sign-up.

Hosted MCP URL (Streamable HTTP):

```
https://covid-flu-rsv-wastewater-levels-mcp.lipmichal.workers.dev/mcp
```

## Quick start

### Claude

Claude Desktop or claude.ai: Settings > Connectors > Add custom connector, then paste the URL above.

Claude Code:

```
claude mcp add --transport http covid-flu-rsv-levels https://covid-flu-rsv-wastewater-levels-mcp.lipmichal.workers.dev/mcp
```

Claude Desktop config file (`claude_desktop_config.json`), through the `mcp-remote` bridge:

```json
{
  "mcpServers": {
    "covid-flu-rsv-levels": { "command": "npx", "args": ["-y", "mcp-remote", "https://covid-flu-rsv-wastewater-levels-mcp.lipmichal.workers.dev/mcp"] }
  }
}
```

### Cursor

Add to `~/.cursor/mcp.json`.

```json
{
  "mcpServers": {
    "covid-flu-rsv-levels": { "url": "https://covid-flu-rsv-wastewater-levels-mcp.lipmichal.workers.dev/mcp" }
  }
}
```

## About

COVID-19, flu and RSV levels for AI assistants, from CDC wastewater surveillance. Ask whether COVID is going around in your state or county this week, whether flu is rising, or which of four states has the most RSV before you travel.

This is a Model Context Protocol (MCP) server. It reads three CDC open datasets on data.cdc.gov (National Wastewater Surveillance System viral activity levels, emergency department respiratory illness activity, and national test positivity) at call time. It needs no API key.

## Tools

| Tool | What it returns |
| --- | --- |
| `covid_flu_rsv_levels_state` | CDC wastewater levels of COVID-19, flu and RSV in one state for the latest week: how many sewershed sites are Very Low to Very High, the share of people served by High or Very High sites, the median site level, the change from last week, a 6-week trend, and the state's emergency department respiratory illness level. |
| `covid_flu_rsv_levels_county` | Wastewater levels at every CDC sewershed site that serves a county, with the last 1 to 12 weeks of COVID-19, flu and RSV readings per site. If no site serves the county, it lists the counties in the state that have one. |
| `covid_flu_rsv_levels_national` | United States: percent of tests positive for COVID-19, influenza and RSV with the weekly trend, the share of people in sewersheds rated High or Very High, and emergency department respiratory illness activity with the highest states. |
| `covid_flu_rsv_compare_states` | Compare COVID-19, flu and RSV wastewater levels across 2 to 10 states at the newest week each state has reported, ranked by the share of people served by sites rated High or Very High. |

Every result has structured JSON, a plain-text summary, `as_of`, `source` and `more` (a page on [mcpstamp.com](https://www.mcpstamp.com/servers/?utm_source=mcp&utm_medium=covid-flu-rsv-wastewater-levels-mcp)). Every tool is marked read-only.

## What it knows that your model does not

- This week's levels. CDC publishes new wastewater, emergency department and test positivity data every week, usually on Fridays, for the week that ended the Saturday before.
- The level of each of about 900 sewershed sites, by county, for SARS-CoV-2, influenza A and RSV, with the population each site serves.
- Which states have not reported the newest week yet, so an older reading is never passed off as this week's.

## Other clients and local install

### Hosted (custom connector, ChatGPT developer mode, any remote MCP client)

Paste this URL. No token, no sign-up.

```
https://covid-flu-rsv-wastewater-levels-mcp.lipmichal.workers.dev/mcp
```

### VS Code

Add to `.vscode/mcp.json`.

```json
{
  "servers": {
    "covid-flu-rsv-levels": { "type": "http", "url": "https://covid-flu-rsv-wastewater-levels-mcp.lipmichal.workers.dev/mcp" }
  }
}
```

### Local stdio

The npm package is not published. Build it from this repository with Node 20 or newer, then point your MCP client at `node /path/to/covid-flu-rsv-wastewater-levels-mcp/dist/stdio.js`.

```
git clone https://github.com/theluckystrike/covid-flu-rsv-wastewater-levels-mcp && cd covid-flu-rsv-wastewater-levels-mcp
npm install && npm run build
node dist/stdio.js
```

## Example prompts

- "Is COVID going around in Ohio right now?"
- "What are the flu and RSV wastewater levels in Cook County, Illinois?"
- "Compare COVID levels in California, Texas, New York and Florida this week."
- "What percent of COVID, flu and RSV tests are positive in the US this week?"

## Data sources

Full list in [DATA_SOURCES.md](DATA_SOURCES.md).

- CDC Wastewater Viral Activity Level for SARS-CoV-2, Influenza A and RSV, data.cdc.gov dataset atcp-73re (one row per sewershed site, pathogen and week)
- CDC Level of Acute Respiratory Illness (ARI) Activity by State, data.cdc.gov dataset f3zz-zga5 (emergency department visits)
- CDC Percent of Tests Positive for Viral Respiratory Pathogens, data.cdc.gov dataset seuz-s2cv (national, NREVSS and flu collaborating labs)

## Limitations

- Weekly data, not daily. The newest week is usually 6 to 13 days old when CDC publishes it.
- CDC does not publish one official wastewater level per state in this dataset. The state tools show how the state's sites are distributed, the share of people served by High or Very High sites, and the median site level.
- Flu means influenza A in wastewater. Test positivity is national only.
- Wastewater measures virus shed into sewers by everyone, including people without symptoms. It is not a case count. Not medical advice.

## More

More MCP servers that answer questions your assistant cannot answer alone are on [mcpstamp.com](https://www.mcpstamp.com/servers/?utm_source=mcp&utm_medium=covid-flu-rsv-wastewater-levels-mcp).

Part of the Zovo MCP collection at https://mcp.zovo.one

Built by [theluckystrike](https://github.com/theluckystrike).

## Development

```
npm install
npm test                              # builds, then runs the fixture tests and an offline stdio test
node scripts/stdio-transcript.mjs     # live stdio round trip, writes .live/stdio-transcript.jsonl
```

CI (`.github/workflows/bundle.yml`) runs the tests, the type check and `wrangler deploy --dry-run --outdir out`, and uploads the Worker bundle as an artifact.

## License

MIT
