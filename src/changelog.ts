import DOMPurify from "dompurify";
import { marked } from "marked";
import { initializeDrawer } from "./drawer.js";

declare const __CHANGELOG_MARKDOWN__: string;

export function initializeChangelog(): ReturnType<typeof initializeDrawer> {
  const content = document.querySelector<HTMLElement>("#changelog-content")!;
  content.innerHTML = DOMPurify.sanitize(marked.parse(__CHANGELOG_MARKDOWN__, { async: false }), {
    FORBID_TAGS: ["img", "style", "iframe"],
  });
  content.addEventListener("click", (event) => {
    if ((event.target as Element).closest("a")) event.preventDefault();
  });

  return initializeDrawer("changelog");
}