# Company Brain

The Company Brain is the company's memory: decisions, facts, lessons,
procedures and assumptions the work has produced or people have written down.
It is organizational memory, not a search index, and it never presents an AI's
conclusion as settled fact.

## Where knowledge comes from

| Source | Shown as | Status when created |
| --- | --- | --- |
| A person writes it | "Added by a person" (or "you") | Current for curators, proposed for members |
| A completed step | "Learned from completed work" | Proposed |
| An artifact | "Extracted from an artifact" (and "approved" once reviewed) | Proposed |
| An approval decision | "Recorded from an approval decision" | As recorded |
| An agent proposes it | "Proposed by an agent" | Proposed |

Every entry also says whether a person has confirmed it. System-derived
knowledge that nobody has reviewed is labelled as a claim to weigh, not a fact
(`whyItExists` in `apps/web/src/lib/knowledge.ts`).

## Scope and visibility

- Knowledge is company-wide or belongs to one workspace; people and agents only
  see what their reach covers.
- Recall and capture are governed like tools: policies can restrict which
  kinds of knowledge are recalled for which agents or workspaces.

## Recall

Before planning and before each step, relevant knowledge is recalled by
relevance, importance and recency (and semantic similarity when a local
embedding model is configured). It reaches the model as a delimited, quoted
section with a trust boundary: knowledge informs the work and can never grant a
tool, remove an approval or change the rules. Entries phrased as instructions
to an AI are flagged.

A skill with `memory: none` runs its steps without recall.

## Capture

When a step completes, capture proposes what was learned; a person reviews and
makes it current. A step that read content from an external system is not mined
automatically - its answer stays in the step and artifact, with its sources,
where a person can propose it deliberately.

## Provenance

Each entry links to the mission, step, artifact and agent it came from, the
model that extracted it and why, which missions have recalled it, conflicts
with other entries and what superseded or merged it.
