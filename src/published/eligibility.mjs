// Adapted from schroneko/automated-hachathon-judge @ 23016a7dcfe71cf67a3d9405a84ff3b9021e203c (MIT).
// See reference/published-20261018 and THIRD_PARTY_NOTICES.md.
export function implementationEligibility(snapshot) {
  return snapshot.files.some((file) => {
    const parts = file.path.toLowerCase().split("/");
    const name = parts.at(-1);
    if (!file.content.trim() || parts.some((part) => /^(?:docs?|documentation|readmes?|\.?config|configs|configuration|\.?settings|\.github|\.vscode|\.idea|\.storybook|\.devcontainer)$/.test(part))
      || /^(?:readme|license|licence|changelog|contributing|code_of_conduct|security)(?:[._-]|$)/.test(name)
      || /(?:^|[._-])(?:config|settings)(?:[._-]|$)/.test(name)
      || /^(?:vite|vitest|webpack|rollup|esbuild|babel|eslint|prettier|tailwind|postcss|next|nuxt|svelte|astro|jest|playwright|cypress|tsconfig|jsconfig|setup|conftest)\./.test(name)
      || /^\.(?:babelrc|eslintrc|prettierrc|stylelintrc)(?:\.|$)/.test(name)
      || /^(?:build\.(?:gradle(?:\.kts)?|sbt|zig)|project\.clj|(?:vite|next)-env\.d\.ts)$/.test(name)) return false;
    if (name.endsWith(".ipynb")) {
      try {
        const notebook = JSON.parse(file.content);
        if (!notebook || typeof notebook !== "object" || !("cells" in notebook) || !Array.isArray(notebook.cells)) return false;
        return notebook.cells.some((cell) => {
          if (!cell || typeof cell !== "object" || !("cell_type" in cell) || cell.cell_type !== "code" || !("source" in cell)) return false;
          const source = cell.source;
          return typeof source === "string" ? !!source.trim() : Array.isArray(source) && source.every((line) => typeof line === "string") && !!source.join("").trim();
        });
      } catch {
        return false;
      }
    }
    if (/\.(?:[cm]?[jt]sx?|vue|svelte|astro|html?|css|s[ac]ss|less|styl|pyw?|pyi|rb|rake|php\d?|phtml|go|rs|java|kt|kts|scala|sc|swift|m|mm|c|h|cc|cpp|cxx|hpp|hxx|cs|fs|fsx|vb|dart|ex|exs|erl|hrl|hs|lhs|ml|mli|clj|cljs|cljc|edn|lisp|lsp|cl|scm|rkt|lua|pl|pm|r|jl|sh|bash|zsh|fish|ps1|psm1|bat|cmd|sql|graphql|gql|sol|move|zig|nim|v|cr|groovy|gvy|gradle|f|f90|f95|for|pas|pp|cob|cbl|asm|s|sv|vhd|vhdl|elm|purs|gleam|re|rei|res|resi|eex|heex|erb|hbs|handlebars|mustache|twig)$/.test(name)) return true;
    if (!name.includes(".")) {
      const lines = file.content.split(/\r?\n/);
      return /^#!\s*\S+/.test(lines[0] ?? "") && lines.slice(1).some((line) => !!line.trim() && !/^\s*#/.test(line));
    }
    return false;
  }) ? "eligible" : "no_implementation";
}
