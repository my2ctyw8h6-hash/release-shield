/** Tiny gitignore-style glob matcher: `*`, `**`, `?`, trailing `/` for directories. */
export function globToRegExp(glob: string): RegExp {
  let g = glob.trim().replace(/^\.\//, "").replace(/^\//, "");
  if (g.endsWith("/")) g += "**";
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*") {
      if (g[i + 1] === "*") {
        i++;
        if (g[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else re += ".*";
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

export function compileGlobs(globs: string[]): (path: string) => boolean {
  const compiled = globs.filter(Boolean).map((g) => ({ re: globToRegExp(g), basenameOnly: !g.replace(/\/$/, "").includes("/") }));
  return (path: string) => {
    const base = path.split("/").pop() ?? path;
    return compiled.some(({ re, basenameOnly }) => re.test(path) || (basenameOnly && (re.test(base) || path.split("/").some((seg) => re.test(seg)))));
  };
}
