# Data sources

All reads are keyless HTTPS GETs to the CDC open data portal (Socrata SODA API) at call time. Answers are cached for 30 minutes.

| Data | Dataset | URL | Update |
| --- | --- | --- | --- |
| Wastewater viral activity level (WVAL) per sewershed site, for SARS-CoV-2, influenza A and RSV | atcp-73re | https://data.cdc.gov/resource/atcp-73re.json | Weekly (Friday) |
| Acute respiratory illness emergency department activity by state | f3zz-zga5 | https://data.cdc.gov/resource/f3zz-zga5.json | Weekly |
| Percent of tests positive for COVID-19, influenza and RSV (national) | seuz-s2cv | https://data.cdc.gov/resource/seuz-s2cv.json | Weekly |

Fields used: state_territory, counties_served, site, population_served, site_wval, site_wval_category, week_end, pathogen_target, date_updated (atcp-73re); week_end, geography, label, percent_visits_ari (f3zz-zga5); week_end, pathogen, percent_test_positivity (seuz-s2cv).

The data is published by the U.S. Centers for Disease Control and Prevention and is in the public domain. This server is not affiliated with or endorsed by CDC.
