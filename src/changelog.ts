import DOMPurify from "dompurify";
import { marked } from "marked";

declare const __CHANGELOG_MARKDOWN__: string;

export function initializeChangelog(): { open: () => void; close: () => void; isOpen: () => boolean } {
  const drawer = document.querySelector<HTMLElement>("#changelog-drawer")!;
  const content = document.querySelector<HTMLElement>("#changelog-content")!;
  const closeButton = document.querySelector<HTMLButtonElement>("#close-changelog")!;
  const resizeHandle = document.querySelector<HTMLElement>("#changelog-resize")!;
  const menuButton = document.querySelector<HTMLButtonElement>("#more-button")!;
  let opened = false;
  let previousFocus: HTMLElement | null = null;
  content.innerHTML = DOMPurify.sanitize(marked.parse(__CHANGELOG_MARKDOWN__, { async: false }), {
    FORBID_TAGS: ["img", "style", "iframe"],
  });
  content.addEventListener("click", (event) => {
    if ((event.target as Element).closest("a")) event.preventDefault();
  });

  function setWidth(width: number): void {
    const maximum = innerWidth * .4;
    const minimum = Math.min(260, maximum);
    const pixels = Math.max(minimum, Math.min(maximum, width));
    drawer.style.width = `${pixels / innerWidth * 100}vw`;
    resizeHandle.setAttribute("aria-valuenow", String(Math.round(pixels / innerWidth * 100)));
    resizeHandle.setAttribute("aria-valuemin", String(Math.round(minimum / innerWidth * 100)));
  }

  resizeHandle.addEventListener("pointerdown", (event) => {
    resizeHandle.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  resizeHandle.addEventListener("pointermove", (event) => {
    if (resizeHandle.hasPointerCapture(event.pointerId)) setWidth(innerWidth - event.clientX);
  });
  resizeHandle.addEventListener("pointerup", (event) => {
    if (resizeHandle.hasPointerCapture(event.pointerId)) resizeHandle.releasePointerCapture(event.pointerId);
  });
  resizeHandle.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const width = drawer.getBoundingClientRect().width;
    setWidth(event.key === "Home" ? 0 : event.key === "End" ? innerWidth : width + (event.key === "ArrowLeft" ? 20 : -20));
  });
  window.addEventListener("resize", () => setWidth(drawer.getBoundingClientRect().width));

  function close(): void {
    opened = false;
    drawer.dataset.open = "false";
    drawer.inert = true;
    if (previousFocus?.isConnected && previousFocus.getClientRects().length) previousFocus.focus();
    else menuButton.focus();
  }
  closeButton.addEventListener("click", close);
  drawer.inert = true;
  return {
    open: () => {
      previousFocus = document.activeElement as HTMLElement | null;
      opened = true;
      drawer.inert = false;
      drawer.dataset.open = "true";
      setWidth(drawer.getBoundingClientRect().width);
      closeButton.focus();
    },
    close,
    isOpen: () => opened,
  };
}