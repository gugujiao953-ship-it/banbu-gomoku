import type { Plugin, Rule } from "postcss";

/** Keep fallbacks next to their original rule, including inside media queries
 * and keyframes. Modern browsers keep the original cascade and specificity. */
export const legacyWebViewCss = (): Plugin => ({
  postcssPlugin: "banbu-legacy-webview-css",
  Once(root) {
    root.walkDecls((declaration) => {
      const fallback = declaration.value.replace(/\b(\d*\.?\d+)[dsl]v([hw])\b/gi, "$1v$2");
      if (fallback !== declaration.value) declaration.cloneBefore({ value: fallback });
    });
    const rules: Rule[] = [];
    root.walkRules((rule) => { if (/:(is|where)\(/.test(rule.selector) && !rule.selector.includes(":has(")) rules.push(rule); });
    for (const rule of rules) {
      // Chrome 79 implements the prefixed spelling. Keep the modern rule
      // untouched and put a parseable fallback immediately before it.
      rule.before(rule.clone({ selector: rule.selector.replace(/:(?:is|where)\(/g, ":-webkit-any(") }));
    }
  },
});
