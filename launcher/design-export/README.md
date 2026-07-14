# Raw design-tool exports (Aya)

These are Aya's original design-TOOL exports of the launcher, kept for reference:

- `Landing Page.dc.html` — the landing page as a dc-runtime (React) framework
  export. Loads `support.js`. This is NOT wired into the build.
- `support.js` — the generated dc-runtime bundle the export above depends on.
- `launcher.zip` — the bundle Aya delivered.

The LIVE, wired launcher is NOT here — it's the repo-idiom port:
- `launcher.html` (repo root, Vite entry)
- `src/ui/launcher-main.ts` (controller)
- `src/ui/launcher.css` (styles)

and the clean design reference Aya wrote in the repo's own idiom is one level up
in `launcher/` (`launcher.html` / `launcher.css` / `launcher.js`). Prefer those;
these raw exports are archive only.
