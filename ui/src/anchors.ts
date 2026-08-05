import type { TextQuoteAnchor } from "./types";

const CONTEXT_LEN = 32;

function textNodesOf(container: HTMLElement): Text[] {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    nodes.push(node as Text);
    node = walker.nextNode();
  }
  return nodes;
}

export function plainTextOf(container: HTMLElement): string {
  return textNodesOf(container)
    .map((node) => node.data)
    .join("");
}

function globalOffset(
  container: HTMLElement,
  targetNode: Node,
  offsetInNode: number,
): number | null {
  if (!container.contains(targetNode)) return null;
  const measure = document.createRange();
  measure.setStart(container, 0);
  measure.setEnd(targetNode, offsetInNode);
  return measure.toString().length;
}

export function captureAnchor(
  container: HTMLElement,
  range: Range,
): TextQuoteAnchor | null {
  const start = globalOffset(
    container,
    range.startContainer,
    range.startOffset,
  );
  const end = globalOffset(container, range.endContainer, range.endOffset);
  if (start === null || end === null || end <= start) return null;
  const text = plainTextOf(container);
  return {
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT_LEN), start),
    suffix: text.slice(end, end + CONTEXT_LEN),
    offsetHint: start,
  };
}

export function findAnchor(
  text: string,
  anchor: TextQuoteAnchor,
): { start: number; end: number } | null {
  const candidates: number[] = [];
  let searchFrom = 0;
  while (true) {
    const index = text.indexOf(anchor.exact, searchFrom);
    if (index === -1) break;
    candidates.push(index);
    searchFrom = index + 1;
  }
  if (candidates.length === 0) return null;
  if (candidates.length === 1) {
    return { start: candidates[0], end: candidates[0] + anchor.exact.length };
  }
  const scored = candidates.map((start) => {
    const end = start + anchor.exact.length;
    let score = 0;
    if (
      anchor.prefix &&
      text.slice(Math.max(0, start - anchor.prefix.length), start) ===
        anchor.prefix
    ) {
      score += 2;
    }
    if (
      anchor.suffix &&
      text.slice(end, end + anchor.suffix.length) === anchor.suffix
    ) {
      score += 2;
    }
    return { start, end, score, distance: Math.abs(start - anchor.offsetHint) };
  });
  scored.sort((a, b) => b.score - a.score || a.distance - b.distance);
  return { start: scored[0].start, end: scored[0].end };
}

export function clearHighlights(container: HTMLElement) {
  for (const mark of Array.from(
    container.querySelectorAll("mark[data-comment-id]"),
  )) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  }
}

export function applyHighlight(
  container: HTMLElement,
  commentId: string,
  start: number,
  end: number,
  active: boolean,
): void {
  let consumed = 0;
  for (const node of textNodesOf(container)) {
    const nodeStart = consumed;
    const nodeEnd = consumed + node.data.length;
    consumed = nodeEnd;
    if (nodeEnd <= start) continue;
    if (nodeStart >= end) break;
    if (node.parentElement?.closest("mark[data-comment-id]")) continue;

    const sliceStart = Math.max(start, nodeStart) - nodeStart;
    const sliceEnd = Math.min(end, nodeEnd) - nodeStart;
    let target = node;
    if (sliceStart > 0) target = target.splitText(sliceStart);
    if (sliceEnd - sliceStart < target.data.length) {
      target.splitText(sliceEnd - sliceStart);
    }
    const mark = document.createElement("mark");
    mark.dataset.commentId = commentId;
    if (active) mark.dataset.active = "true";
    target.parentNode?.replaceChild(mark, target);
    mark.appendChild(target);
  }
}
