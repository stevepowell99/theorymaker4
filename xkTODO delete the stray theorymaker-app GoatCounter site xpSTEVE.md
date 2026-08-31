# Delete the stray `theorymaker-app` GoatCounter site

Claude created site `theorymaker-app` (id 102490) on 31 August 2026, having
misread the account layout, and briefly pointed theorymaker at it. The snippet
in `index.html` is back on `theorymaker.goatcounter.com`, so the stray site
holds at most a few minutes of hits and nothing depends on it.

The API has no delete for sites, so it needs the UI: sign in, switch to
`theorymaker-app`, Settings > Delete site.

Background: theorymaker (id 69298) is the ROOT site of the account, with the
Garden, causalmap and qualiainterviews as its children. `GET /api/v0/sites`
addressed to a child host lists only that child and its own children, never the
parent, which is what made theorymaker look like it was on another account.
