# tahosapp localization contract

tahosapp supports Turkish, English, German, French, Spanish, Brazilian Portuguese,
Italian, Russian, Arabic, Japanese, Korean, and Simplified Chinese.

- New React interface text must use a semantic key from `frontend/src/i18n/catalog.js`.
- Every semantic key must be translated in every supported locale. `npm run i18n:check`
  blocks a build when a locale is missing a key.
- User-written messages, usernames, server names, and channel names are never translated.
- The generated Turkish compatibility catalogs cover the existing pre-i18n interface.
  New work must not add entries to that legacy layer.
- Public-site pages must load both site localization scripts. Shared site navigation and
  product labels belong in `deployment/site/assets/i18n.js`.
