import { safeStringify } from "../lib/events";

/**
 * What an agent produced.
 *
 * Agent output is prose far more often than it is data, and rendering it in a
 * monospace code block made every deliverable read like a log dump. Strings
 * render as text with their bullet lists and light emphasis honoured; anything
 * structured keeps the code block, where monospace is the right answer.
 *
 * This lives here rather than inside the work detail page because the artifact
 * shelf shows exactly the same values, and two renderers would eventually
 * disagree about what a result looks like.
 */
export function ResultBody({ value }: { value: unknown }) {
  if (typeof value !== "string") {
    return <pre className="code-block">{safeStringify(value, 2)}</pre>;
  }

  return <div className="prose-result">{renderBlocks(value)}</div>;
}

const BULLET = /^\s*[-*•]\s+/;

function renderBlocks(text: string) {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, blockIndex) => {
      const lines = splitLines(block);
      const bullets = lines.filter((line) => BULLET.test(line));

      // Models emit bullets on single newlines, so a paragraph-only splitter
      // ran "- Salaries: 48,200 - Cloud: 9,350" together into one line.
      if (bullets.length > 1) {
        const lead = lines.find((line) => !BULLET.test(line));

        return (
          <div key={blockIndex}>
            {lead && <p>{renderEmphasis(lead)}</p>}

            <ul>
              {bullets.map((line, index) => (
                <li key={index}>{renderEmphasis(line.replace(BULLET, ""))}</li>
              ))}
            </ul>
          </div>
        );
      }

      return (
        <p key={blockIndex}>
          {renderEmphasis(block.replace(/\s*\n\s*/g, " "))}
        </p>
      );
    });
}

/**
 * Bullets are not always on their own line - a model that wrote the list
 * inline still means a list, so " - " before a new item breaks too.
 */
function splitLines(block: string): string[] {
  return block
    .split(/\n|(?=\s-\s(?=[A-Z0-9]))/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * The models reliably emit **bold** and nothing else worth parsing, so this
 * handles exactly that rather than pulling in a markdown renderer.
 */
function renderEmphasis(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={index}>{part.slice(2, -2)}</strong>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}
