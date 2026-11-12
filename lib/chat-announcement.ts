import type { UIMessage } from "ai";

import { answerTextIndexes } from "./chat-visibility";

/** Reply text for the screen-reader announcement, without Markdown syntax. */
export function announcementText(message: Pick<UIMessage, "parts">): string {
  const answer = answerTextIndexes(message);
  return message.parts
    .map((part, index) =>
      part.type === "text" && answer.has(index) ? part.text : "",
    )
    .join("")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images → alt text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → link text
    .replace(/^\s*(?:[-+]|\d+\.)\s+/gm, "") // list markers
    .replace(/[*_`~#>|]/g, "") // emphasis, code, headings, quotes, tables
    .replace(/\s+/g, " ")
    .trim();
}
