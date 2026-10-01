# Font licenses

All three typefaces are free under the SIL Open Font License 1.1 (OFL). It is not the MIT license, but it is just as permissive for an app: you may bundle the fonts in a commercial or non-commercial product, embed them, and convert or subset them. Full texts are in `assets/Licenses/`.

| Font | Used for | Copyright | Reserved Font Name |
| --- | --- | --- | --- |
| Onest | UI text (`sans`) | Copyright 2021 The Onest Project Authors | none declared |
| JetBrains Mono | numbers, URLs (`mono`) | Copyright 2020 The JetBrains Mono Project Authors | none declared |
| Alegreya Sans | titles and wordmark (`display`) | Copyright 2013 The Alegreya Sans Project Authors (Juan Pablo del Peral) | none in the Google Fonts build used here; the upstream repository declares "Alegreya Sans" |

What you must do:
- Keep the copyright line and the OFL text with the fonts you ship (the files in `assets/Licenses/`).
- Do not sell the font files on their own. Selling the app that contains them is fine.
- If you modify a font and its license declares a Reserved Font Name, rename the modified font. The files in `fonts/` are Latin + Cyrillic subsets of the Google Fonts builds (no glyph changes). If you swap in the upstream Alegreya Sans and subset it again, give the result a different family name.
- A modified font stays under the OFL; the rest of the app can use any license.

Not legal advice: for a public release, read the OFL text and its FAQ at openfontlicense.org.
