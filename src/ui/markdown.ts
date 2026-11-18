/** 리포트용 아주 작은 Markdown → HTML 변환기 (제목, 목록, 표, 굵게만) */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

export function renderMarkdown(md: string): string {
  const lines = md.split('\n');
  const html: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('|')) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      const cells = (r: string) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const align = cells(rows[1] ?? '').map((c) => c.endsWith(':'));
      const head = cells(rows[0]).map((c, k) => `<th${align[k] ? ' class="num"' : ''}>${inline(c)}</th>`).join('');
      const body = rows.slice(2).map((r) => `<tr>${cells(r).map((c, k) => `<td${align[k] ? ' class="num"' : ''}>${inline(c)}</td>`).join('')}</tr>`).join('');
      html.push(`<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`);
      continue;
    }
    if (/^\s*- /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*- /.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(/^\s*- /, ''))}</li>`);
      html.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    const h = line.match(/^(#{1,3}) (.*)$/);
    if (h) html.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`);
    else if (line.trim()) html.push(`<p>${inline(line)}</p>`);
    i++;
  }
  return html.join('\n');
}
