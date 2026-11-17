"use client";

import { useState } from "react";
import type { Fix } from "@/lib/remediation";

function CopyBlock({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="fix-block">
      <div className="fix-head">
        <code>{label}</code>
        <button
          type="button"
          className="btn btn-sm btn-outline"
          onClick={async () => {
            await navigator.clipboard.writeText(value + "\n");
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <pre className="code left">
        <code>{value}</code>
      </pre>
    </div>
  );
}

export function FixPanel({ fix, title = "Fix it" }: { fix: Fix; title?: string }) {
  if (!fix.ignore && fix.rotate.length === 0) return null;
  return (
    <div className="fix">
      <strong>{title}</strong>
      {fix.rotate.length > 0 && (
        <div className="alert small" style={{ color: "var(--text)" }}>
          Excluding the file does not un-publish it. Old versions stay on the registry. Rotate first: {fix.rotate.join(", ")}.
        </div>
      )}
      {fix.ignore && <CopyBlock label={`1. Append to ${fix.file}`} value={fix.ignore} />}
      <CopyBlock label={`${fix.ignore ? "2" : "1"}. Verify before publishing`} value={fix.verify} />
      {fix.notes.length > 0 && (
        <ul className="small muted fix-notes">
          {fix.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
