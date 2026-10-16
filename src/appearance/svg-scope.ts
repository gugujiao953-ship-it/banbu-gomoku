/** SVG resource IDs are document-global, including across separate SVGs. */
export function scopeSvgFragment(html: string, css: string, scope: string): { html: string; css: string } {
  const ids = new Map<string, string>();
  const scopedHtml = html.replace(/\bid=(["'])([^"']+)\1/g, (_, quote: string, id: string) => {
    const scoped = `${scope}-${id}`;
    ids.set(id, scoped);
    return `id=${quote}${scoped}${quote}`;
  });
  const references = (text: string) => text
    .replace(/url\(\s*(["']?)#([^)'"\s]+)\1\s*\)/g, (whole, quote: string, id: string) =>
      ids.has(id) ? `url(${quote}#${ids.get(id)}${quote})` : whole)
    .replace(/\b((?:xlink:)?href)=(["'])#([^"']+)\2/g, (whole, name: string, quote: string, id: string) =>
      ids.has(id) ? `${name}=${quote}#${ids.get(id)}${quote}` : whole);
  return { html: references(scopedHtml), css: references(css) };
}
