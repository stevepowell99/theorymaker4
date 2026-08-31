# Delete two stray GoatCounter sites

Claude created four sites on 31 August 2026 while working out the account
layout. Two are wanted and wired to live sites; two are strays holding no data:

- `theorymaker-app` (id 102490) - redundant, theorymaker uses its own site.
- `qualia` (id 102503) - created to test token scope; the live Qualia site
  reports to `qualiainterviews` instead.

The API has no delete for sites, so each needs the UI: switch to it in the Sites
list, Settings > Delete site.

Keep `causalmap` (102476) and `qualiainterviews` (102477).
