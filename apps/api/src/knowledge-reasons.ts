/**
 * Why a piece of knowledge was recalled, said to a person.
 *
 * The ranker records its reasons as it ranks - "Matched the topic of the work
 * (similarity 0.71)" - and that figure belongs there. It is how the ordering
 * can be explained afterwards, it travels into the recall rows, and an agent
 * reading it in a prompt is no worse off for it.
 *
 * A person is. "Similarity 0.71" invites them to compare it against 0.66 and
 * conclude something about the company's knowledge that a cosine distance
 * between two embeddings does not support. What they asked is why they are
 * being shown this, and the sentence answers that on its own: it matched the
 * topic of the work. So the number comes off the sentence on its way to a
 * page, and nothing else about it changes.
 *
 * Only a trailing parenthetical carrying a bare measurement is removed. A
 * reason that has something to say inside brackets keeps it.
 */

const MEASUREMENT = /\s*\((?:similarity|score|rank|match)\s+[\d.]+\)\s*$/i;

export function readableRecallReason(reason: string): string {
  return reason.replace(MEASUREMENT, "").trim();
}

export function readableRecallReasons(reasons: string[]): string[] {
  return reasons.map(readableRecallReason).filter((reason) => reason.length > 0);
}
