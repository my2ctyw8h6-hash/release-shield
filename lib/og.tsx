import { ImageResponse } from "next/og";

/** 1200×630 social preview card shared by the homepage and /npm report pages. Satori: every multi-child div needs display:flex. */
export const OG_SIZE = { width: 1200, height: 630 };

export interface OgCard {
  kicker: string;
  title: string;
  lines: string[];
  stats?: { value: string; label: string }[];
  status?: { text: string; color: string };
}

const C = { bg: "#0b0f17", card: "#121a28", border: "#1f2a3d", text: "#e6edf6", muted: "#8a99b2", accent: "#22c55e" };

const shield = (
  <svg width="56" height="56" viewBox="0 0 32 32">
    <path d="M16 2 4 7v8c0 7.5 5.1 13.4 12 15 6.9-1.6 12-7.5 12-15V7L16 2z" fill={C.accent} />
    <path d="m11 16 3.5 3.5L21.5 12" stroke={C.bg} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function renderOgCard(c: OgCard, headers?: Record<string, string>) {
  const titleSize = c.title.length > 34 ? 56 : c.title.length > 22 ? 68 : 80;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: C.bg, color: C.text, padding: "56px 64px", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {shield}
          <div style={{ display: "flex", fontSize: 34, fontWeight: 700 }}>ReleaseShield</div>
          <div style={{ display: "flex", marginLeft: "auto", fontSize: 26, color: C.muted }}>{c.kicker}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginTop: 48, flexGrow: 1 }}>
          <div style={{ display: "flex", fontSize: titleSize, fontWeight: 800, lineHeight: 1.1, wordBreak: "break-word" }}>{c.title}</div>
          {c.status && (
            <div style={{ display: "flex", marginTop: 24 }}>
              <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: "#fff", background: c.status.color, borderRadius: 10, padding: "8px 20px" }}>
                {c.status.text}
              </div>
            </div>
          )}
          {c.lines.map((l) => (
            <div key={l} style={{ display: "flex", fontSize: 30, color: C.muted, marginTop: 18 }}>{l}</div>
          ))}
        </div>

        {c.stats && c.stats.length > 0 && (
          <div style={{ display: "flex", gap: 20 }}>
            {c.stats.map((s) => (
              <div key={s.label} style={{ display: "flex", flexDirection: "column", flex: 1, background: C.card, border: `2px solid ${C.border}`, borderRadius: 14, padding: "16px 24px" }}>
                <div style={{ display: "flex", fontSize: 36, fontWeight: 700 }}>{s.value}</div>
                <div style={{ display: "flex", fontSize: 22, color: C.muted }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    ),
    { ...OG_SIZE, headers },
  );
}
