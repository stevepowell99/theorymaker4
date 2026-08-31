# Retire the old theorymaker GoatCounter site

Theorymaker now reports to `theorymaker-app.goatcounter.com`, which sits on the
`hello@causalmap.app` GoatCounter account alongside the Garden, causalmap.app
and Qualia. The old site, `theorymaker.goatcounter.com`, is on a separate
account that Claude has no access to, so its figures stay stranded there.

Two things to do in that old account, both needing a sign-in only Steve has:

1. **Bring the history across, if it is worth keeping.** In the old account,
   Settings > Export, take the CSV, then in the new site use Settings > Import
   and upload it. GoatCounter reads its own export format.
2. **Free the nicer code.** Rename the old site's code (Settings > Site code) or
   delete the site once its data is exported. Then `theorymaker` is available
   and the snippet in `index.html` can drop the `-app` suffix.

Until then nothing is broken: hits from the next Netlify deploy onwards land in
the new site.
