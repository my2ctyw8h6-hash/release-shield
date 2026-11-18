/**
 * Plain GET form: /?scan=<name>#check runs the live scan on the homepage (LeakChecker deep link).
 * No JS, so it works on statically rendered report pages; attribution rides on the session ref.
 */
export function ScanOwnForm({ label = "Check your own package before the next publish" }: { label?: string }) {
  return (
    <form action="/#check" method="get" className="card" style={{ margin: "1.25rem 0", padding: "1rem" }}>
      <label htmlFor="scan-own" className="small" style={{ display: "block", marginBottom: "0.5rem" }}>
        {label}: free, no login, scans the published tarball.
      </label>
      <div className="checker-form">
        <input
          id="scan-own"
          name="scan"
          className="input"
          placeholder="your-package or @scope/name"
          required
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" className="btn btn-primary">Scan</button>
      </div>
    </form>
  );
}
