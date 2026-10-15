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
      section.open = !content.querySelector("details");
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
  const drawer = initializeDrawer("help");
  const search = initializeHelpSearch(content);
  document.addEventListener("keydown", (event) => {
    if (drawer.isOpen() && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      search.focus();
    }
  });
  return drawer;
}

function initializeHelpSearch(content: HTMLElement): { focus: () => void } {
  const input = document.querySelector<HTMLInputElement>("#help-search")!;
  const status = document.querySelector<HTMLElement>("#help-search-status")!;
  const sections = [...content.querySelectorAll<HTMLDetailsElement>("details.help-section")];
  const highlights = typeof CSS !== "undefined" && "highlights" in CSS ? CSS.highlights : undefined;
  // Expanded/collapsed state from before the search began, restored when the search is cleared.
  let savedOpen: boolean[] | undefined;

  function highlight(query: string): void {
    if (!highlights) return;
    if (!query) {
      highlights.delete("help-match");
      return;
    }
    const ranges: Range[] = [];
    for (const section of sections) {
      if (section.hidden) continue;
      const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent!.toLocaleLowerCase();
        for (let index = text.indexOf(query); index !== -1; index = text.indexOf(query, index + query.length)) {
          const range = new Range();
          range.setStart(node, index);
          range.setEnd(node, index + query.length);
          ranges.push(range);
        }
      }
    }
    highlights.set("help-match", new Highlight(...ranges));
  }

  function apply(): void {
    const raw = input.value.replace(/\s+/g, " ").trim();
    const query = raw.toLocaleLowerCase();
    if (!query) {
      for (const [index, section] of sections.entries()) {
        section.hidden = false;
        if (savedOpen) section.open = savedOpen[index]!;
      }
      savedOpen = undefined;
      status.textContent = "";
      highlight("");
      return;
    }
    savedOpen ??= sections.map((section) => section.open);
    let matches = 0;
    for (const section of sections) {
      const match = section.textContent!.replace(/\s+/g, " ").toLocaleLowerCase().includes(query);
      section.hidden = !match;
      if (match) {
        section.open = true;
        matches += 1;
      }
    }
    status.textContent = matches === 0
      ? `No help sections contain "${raw}".`
      : `${matches} of ${sections.length} sections contain "${raw}".`;
    highlight(query);
  }

  input.addEventListener("input", apply);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && input.value) {
      event.preventDefault();
      event.stopPropagation();
      input.value = "";
      apply();
    }
  });
  return {
    focus: () => {
      input.focus();
      input.select();
    },
  };
}