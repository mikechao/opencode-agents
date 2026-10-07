import { displayPath } from "../../../src/proposal.ts"

// Prose is presentation only. Normalize punctuation/spacing, preserve printable
// Unicode, and make controls, bidi/formatting, and isolated marks visible text.
// NFC keeps ordinary accented words readable before remaining marks are escaped.
export const repairProse = (value: string): string =>
  value
    .normalize("NFC")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\p{Zs}/gu, " ")
    .replace(/[\p{C}\p{M}\p{Zl}\p{Zp}]/gu, (character) => displayPath(character).slice(1, -1))
