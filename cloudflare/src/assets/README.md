# Fonts for document export

The base64 data in `fonts.js` is the unmodified Noto Sans Regular and Bold TTF fonts from [notofonts/noto-fonts](https://github.com/notofonts/noto-fonts/tree/main/hinted/ttf/NotoSans). It is bundled so PDF generation never downloads fonts or sends user documents to a third-party converter.

These fonts are distributed under the SIL Open Font License 1.1; see `NotoSans-LICENSE.txt`. Kazakh, Russian, and English glyphs are covered. PDFs embed only the used glyphs. Editable Word files use Arial, available in Word, with Unicode text preserved.

Decorative icons used by the bot are omitted from print documents. An uncommon PDF character outside the font coverage is represented explicitly as `[U+XXXX]`; it is not silently dropped or rendered as an empty square. DOCX preserves such characters.
