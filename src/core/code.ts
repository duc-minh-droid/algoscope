export interface CodeLine {
  text: string;
  tags: string[];
}

const TAG_RE = /\s*(?:\/\/|#)@([\w,\-]+)\s*$/;

/** Splits a listing into lines and extracts trailing `//@tag` / `#@tag` markers. */
export function parseCode(src: string): CodeLine[] {
  const lines = src.replace(/^\n+|\s+$/g, '').split('\n');
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)![0].length));
  return lines.map((raw) => {
    const m = raw.match(TAG_RE);
    const text = (m ? raw.slice(0, m.index) : raw).slice(indent).replace(/\s+$/, '');
    return { text, tags: m ? m[1].split(',') : [] };
  });
}

export type Lang = 'js' | 'py';

const KW: Record<Lang, Set<string>> = {
  js: new Set(
    'function return if else for while do const let var new of in break continue true false null undefined class this yield switch case default typeof'.split(' '),
  ),
  py: new Set('def return if elif else for while in not and or is None True False class self yield break continue lambda pass import from as with'.split(' ')),
};
const BUILTIN = new Set(
  'Math Infinity len range min max abs print push pop shift unshift length sort map heapq append float int str list dict set deque sum floor Array Map Set Object'.split(' '),
);

export interface Token {
  t: string;
  k: 'kw' | 'num' | 'str' | 'com' | 'fn' | 'bi' | 'op' | 'id' | 'ws';
}

export function tokenize(line: string, lang: Lang): Token[] {
  const out: Token[] = [];
  const re =
    lang === 'py'
      ? /(\s+)|(#.*)|("[^"]*"|'[^']*')|(\d+(?:\.\d+)?)|([A-Za-z_][\w]*)|(.)/g
      : /(\s+)|(\/\/.*)|("[^"]*"|'[^']*'|`[^`]*`)|(\d+(?:\.\d+)?)|([A-Za-z_$][\w$]*)|(.)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const [s, ws, com, str, num, id] = m;
    if (ws) out.push({ t: s, k: 'ws' });
    else if (com) out.push({ t: s, k: 'com' });
    else if (str) out.push({ t: s, k: 'str' });
    else if (num) out.push({ t: s, k: 'num' });
    else if (id) {
      const next = line.slice(re.lastIndex).trimStart()[0];
      out.push({ t: s, k: KW[lang].has(s) ? 'kw' : BUILTIN.has(s) ? 'bi' : next === '(' ? 'fn' : 'id' });
    } else out.push({ t: s, k: 'op' });
  }
  return out;
}
