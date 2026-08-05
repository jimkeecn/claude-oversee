import { diffLines } from "diff";

export function DiffView({ before, after }: { before: string; after: string }) {
  const parts = diffLines(before, after);
  return (
    <pre className="diff-view">
      {parts.map((part, index) => (
        <span
          key={index}
          className={part.added ? "diff-add" : part.removed ? "diff-del" : ""}
        >
          {part.value}
        </span>
      ))}
    </pre>
  );
}
