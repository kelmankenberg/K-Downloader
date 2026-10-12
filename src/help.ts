import DOMPurify from "dompurify";
import { marked, type Token } from "marked";
import { initializeDrawer } from "./drawer.js";

declare const __HELP_MARKDOWN__: string;

export function initializeHelp(): ReturnType<typeof initializeDrawer> {
  const content = document.querySelector<HTMLElement>("#help-content")!;
  let section: HTMLDetailsElement | undefined;
  let tokens: Token[] = [];
  function renderSection(): void {
    if (!section) return;
    const body = document.createElement("div");
    body.className = "help-section-body";
    body.innerHTML = DOMPurify.sanitize(marked.parser(tokens), { FORBID_TAGS: ["img", "style", "iframe"] });
    section.append(body);
    tokens = [];
  }
  for (const token of marked.lexer(__HELP_MARKDOWN__)) {
    if (token.type === "heading" && token.depth === 2) {
      renderSection();
      section = document.createElement("details");
      section.className = "help-section";
      section.open = content.childElementCount === 0;
      const heading = document.createElement("summary");
      heading.textContent = token.text;
      section.append(heading);
      content.append(section);
    } else if (section) tokens.push(token);
  }
  renderSection();
  content.addEventListener("click", (event) => {
    if ((event.target as Element).closest("a")) event.preventDefault();
  });
  document.querySelector("#expand-help")!.addEventListener("click", () => {
    content.querySelectorAll("details").forEach((section) => { section.open = true; });
  });
  document.querySelector("#collapse-help")!.addEventListener("click", () => {
    content.querySelectorAll("details").forEach((section) => { section.open = false; });
  });
  return initializeDrawer("help");
}