/**
 * A Song's title or other name as Compose's search compares it (#323): lower case, without accents
 * or apostrophes, "&" as "and", and every run of other punctuation and spaces as one space. So "oh
 * susanna" finds "Oh! Susanna", "frere" finds "Frère Jacques", and "teddy bears" finds "The Teddy
 * Bears' Picnic". As the catalog tools' `pdmx.normalize`, which matched the names to their scores.
 */
export function searchKey(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('en')
    .replaceAll('&', ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}
