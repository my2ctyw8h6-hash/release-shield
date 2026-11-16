export function Logo() {
  return (
    <a href="/" className="logo" aria-label="ReleaseShield home">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
        <path d="M16 2 4 7v8c0 7.5 5.1 13.4 12 15 6.9-1.6 12-7.5 12-15V7L16 2z" fill="var(--accent)" />
        <path d="m11 16 3.5 3.5L21.5 12" stroke="var(--bg)" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>ReleaseShield</span>
    </a>
  );
}
