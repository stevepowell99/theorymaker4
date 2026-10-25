# Delete three stray GoatCounter sites

Claude created these on 31 August 2026 while working out the account layout. They sit under the Garden site (`causal-mapping-garden`) rather than the account root, where no token can read them. `goat-report.py` skips them by name (`IGNORE_CODES`):

- `causalmap` (id 102476)
- `qualiainterviews` (id 102477)
- `theorymaker-app` (id 102490)

The API has no delete for sites, so each needs the UI: open the Garden site's Sites list, switch to the stray, then Settings > Delete site. Afterwards remove the deleted codes from `IGNORE_CODES` in `C:\Users\Zoom\.claude\bin\goat-report.py`.

**Keep the four live sites**, all on the account root (hits are for 26 August to 25 October 2026, read through the API on 25 October 2026):

- `theorymaker` (69298), 1,259 hits
- `causal-map` (102505), causalmap.app, 1,202 hits
- `causal-mapping-garden` (70649), 843 hits
- `qualia` (102503), qualiainterviews.com, 414 hits; `qualia-site\config.yml` counts to `qualia.goatcounter.com`
