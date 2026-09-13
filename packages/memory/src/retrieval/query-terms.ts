/**
 * The words a query is actually about.
 *
 * Used twice: to build the full-text query handed to the database, and to name
 * the shared words when explaining why a piece of knowledge was retrieved. The
 * same function does both so the explanation can never cite a match the search
 * did not look for.
 */

const STOPWORDS = new Set([
  "a", "about", "after", "all", "also", "an", "and", "any", "are", "as", "at",
  "be", "because", "been", "before", "being", "but", "by", "can", "could",
  "did", "do", "does", "for", "from", "had", "has", "have", "how", "if", "in",
  "into", "is", "it", "its", "just", "may", "more", "most", "must", "new",
  "not", "now", "of", "on", "or", "our", "out", "over", "should", "so", "some",
  "such", "than", "that", "the", "their", "them", "then", "there", "these",
  "they", "this", "those", "through", "to", "up", "use", "using", "was", "we",
  "were", "what", "when", "where", "which", "while", "who", "why", "will",
  "with", "would", "you", "your",
  // Words every mission contains and that therefore distinguish nothing.
  "create", "make", "task", "work", "please",
]);

const MAX_TERMS = 24;

/** Lowercased, de-duplicated, stopword-free terms of at least three letters. */
export function queryTerms(text: string): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();

  for (const raw of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (raw.length < 3 || STOPWORDS.has(raw)) continue;

    const term = stem(raw);

    if (seen.has(term)) continue;

    seen.add(term);
    terms.push(term);

    if (terms.length >= MAX_TERMS) break;
  }

  return terms;
}

/**
 * An any-word Postgres tsquery. Every term is alphanumeric by construction,
 * so the string is always valid tsquery syntax and carries no operators a
 * caller could inject.
 */
export function toTsQueryTerms(terms: string[]): string {
  return terms.filter((term) => /^[a-z0-9]+$/.test(term)).join(" | ");
}

/** The query terms that also appear in the text, in query order. */
export function sharedTerms(terms: string[], text: string): string[] {
  const present = new Set(queryTerms(text));
  return terms.filter((term) => present.has(term));
}

/**
 * A deliberately small stemmer: enough that "pricing" matches "price" and
 * "decisions" matches "decision", without pulling in a library for it.
 */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith("ing")) return trimE(word.slice(0, -3));
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith("ed")) return trimE(word.slice(0, -2));
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function trimE(word: string): string {
  return word.endsWith("e") ? word.slice(0, -1) : word;
}
