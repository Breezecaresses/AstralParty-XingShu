export interface RichColorStop {
  hex: string;
  opacity: number;
}

export interface RichNameRun {
  text: string;
  colors: RichColorStop[] | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
}

export interface ParsedRichGameName {
  plain: string;
  runs: RichNameRun[];
  hasRichStyle: boolean;
  sawStyleTag: boolean;
}

const NAMED_COLORS = new Map<string, string>([
  ['aliceblue', '#F0F8FF'], ['aqua', '#00FFFF'], ['aquamarine', '#7FFFD4'], ['azure', '#F0FFFF'],
  ['beige', '#F5F5DC'], ['black', '#000000'], ['blue', '#0000FF'], ['blueviolet', '#8A2BE2'],
  ['brown', '#A52A2A'], ['chocolate', '#D2691E'], ['coral', '#FF7F50'], ['cornflowerblue', '#6495ED'],
  ['crimson', '#DC143C'], ['cyan', '#00FFFF'], ['darkblue', '#00008B'], ['darkcyan', '#008B8B'],
  ['darkgray', '#A9A9A9'], ['darkgreen', '#006400'], ['darkmagenta', '#8B008B'], ['darkorange', '#FF8C00'],
  ['darkorchid', '#9932CC'], ['darkred', '#8B0000'], ['darkviolet', '#9400D3'], ['deeppink', '#FF1493'],
  ['deepskyblue', '#00BFFF'], ['dodgerblue', '#1E90FF'], ['firebrick', '#B22222'], ['forestgreen', '#228B22'],
  ['fuchsia', '#FF00FF'], ['gold', '#FFD700'], ['goldenrod', '#DAA520'], ['gray', '#808080'],
  ['green', '#008000'], ['greenyellow', '#ADFF2F'], ['grey', '#808080'], ['hotpink', '#FF69B4'],
  ['indigo', '#4B0082'], ['ivory', '#FFFFF0'], ['khaki', '#F0E68C'], ['lavender', '#E6E6FA'],
  ['lightblue', '#ADD8E6'], ['lightcoral', '#F08080'], ['lightcyan', '#E0FFFF'], ['lightgreen', '#90EE90'],
  ['lightpink', '#FFB6C1'], ['lightskyblue', '#87CEFA'], ['lime', '#00FF00'], ['limegreen', '#32CD32'],
  ['magenta', '#FF00FF'], ['maroon', '#800000'], ['mediumorchid', '#BA55D3'], ['mediumpurple', '#9370DB'],
  ['midnightblue', '#191970'], ['mintcream', '#F5FFFA'], ['mistyrose', '#FFE4E1'], ['navy', '#000080'],
  ['olive', '#808000'], ['orange', '#FFA500'], ['orangered', '#FF4500'], ['orchid', '#DA70D6'],
  ['palegreen', '#98FB98'], ['paleturquoise', '#AFEEEE'], ['palevioletred', '#DB7093'], ['peachpuff', '#FFDAB9'],
  ['peru', '#CD853F'], ['pink', '#FFC0CB'], ['plum', '#DDA0DD'], ['purple', '#800080'],
  ['red', '#FF0000'], ['rosybrown', '#BC8F8F'], ['royalblue', '#4169E1'], ['salmon', '#FA8072'],
  ['seagreen', '#2E8B57'], ['silver', '#C0C0C0'], ['skyblue', '#87CEEB'], ['slateblue', '#6A5ACD'],
  ['springgreen', '#00FF7F'], ['steelblue', '#4682B4'], ['tan', '#D2B48C'], ['teal', '#008080'],
  ['tomato', '#FF6347'], ['turquoise', '#40E0D0'], ['violet', '#EE82EE'], ['wheat', '#F5DEB3'],
  ['white', '#FFFFFF'], ['yellow', '#FFFF00'], ['yellowgreen', '#9ACD32'],
]);

const UBB_TAG_RE = /\[(\/?)(color|gradient|size|font|align|url|img|b|i|u|s|strike|sup|sub)(?:\s*=\s*([^\]]*))?\]/giu;
const HTML_TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)(?:\s*=\s*([^>]*)|\s+([^>]*))?>/gu;
const TRAILING_BROKEN_RICH_RE =
  /(?:\[(?:\/[a-z]{0,10}|(?:colo|col|grad|gradi|gradie|gradien|str|stri|strik)|(?:color|gradient|size|font|align|url|img|b|i|u|s|strike|sup|sub)(?:=[^\]]*)?)|<(?:\/[a-z]{0,10}|(?:color|gradient|size|font|b|i|u|s|strike|sup|sub|script)(?:[=\s][^>]*)?))$/iu;
const RICH_HTML_NAMES = new Set(['color', 'gradient', 'font', 'size', 'b', 'i', 'u', 's', 'strike', 'sup', 'sub']);

function parseSingleColor(raw: string): RichColorStop | null {
  const token = String(raw ?? '').trim().replace(/^["']|["']$/gu, '').trim();
  if (!token) return null;
  if (/^#[0-9a-f]{3}$/iu.test(token)) {
    const hex = ('#' + token[1] + token[1] + token[2] + token[2] + token[3] + token[3]).toUpperCase();
    return { hex, opacity: 1 };
  }
  if (/^#[0-9a-f]{6}$/iu.test(token)) {
    return { hex: token.toUpperCase(), opacity: 1 };
  }
  if (/^#[0-9a-f]{8}$/iu.test(token)) {
    const hex = token.slice(0, 7).toUpperCase();
    const alpha = parseInt(token.slice(7, 9), 16) / 255;
    return { hex, opacity: Math.round(alpha * 1000) / 1000 };
  }
  const named = NAMED_COLORS.get(token.toLowerCase());
  if (named) {
    return { hex: named, opacity: 1 };
  }
  return null;
}

function parseColorList(attr: string): RichColorStop[] {
  const clean = String(attr ?? '').trim().replace(/^["']|["']$/gu, '').trim();
  if (!clean) return [];
  const out: RichColorStop[] = [];
  for (const part of clean.split(/[\s,|]+/u).slice(0, 4)) {
    if (!part) continue;
    const c = parseSingleColor(part);
    if (c) out.push(c);
  }
  return out;
}

function extractHtmlAttr(rawAttr: string, name: string): string {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'iu').exec(String(rawAttr ?? ''));
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : '';
}

function colorsEqual(a: RichColorStop[] | null, b: RichColorStop[] | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].hex !== b[i].hex || a[i].opacity !== b[i].opacity) return false;
  }
  return true;
}

function stylesEqual(a: Omit<RichNameRun, 'text'>, b: Omit<RichNameRun, 'text'>): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strike === b.strike &&
    colorsEqual(a.colors, b.colors)
  );
}

export function parseRichGameName(raw: string | null | undefined): ParsedRichGameName {
  // Strip control characters and dangling partial rich-text tags at truncation boundaries.
  let source = String(raw ?? '').replace(/[\x00-\x1f\x7f]/gu, ' ');
  source = source.replace(TRAILING_BROKEN_RICH_RE, '');
  if (/(?:\[\/?(?:color|gradient|b|i|u|s|strike|size|font)\b|<\/?(?:color|font|b|i|u|s|strike)\b)/iu.test(source)) {
    source = source.replace(/[\[<]+$/u, '');
  }

  type Token =
    | { type: 'text'; value: string }
    | { type: 'tag'; closing: boolean; tag: string; attr: string };

  const tokens: Token[] = [];
  const combined = new RegExp(`${UBB_TAG_RE.source}|${HTML_TAG_RE.source}`, 'giu');
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = combined.exec(source)) !== null) {
    if (match.index > last) {
      tokens.push({ type: 'text', value: source.slice(last, match.index) });
    }
    last = combined.lastIndex;
    if (match[2] !== undefined) {
      tokens.push({
        type: 'tag',
        closing: match[1] === '/',
        tag: match[2].toLowerCase(),
        attr: match[3] ?? '',
      });
    } else if (match[5] !== undefined) {
      const tag = match[5].toLowerCase();
      if (RICH_HTML_NAMES.has(tag)) {
        const attr = match[6] !== undefined ? match[6] : tag === 'font' ? extractHtmlAttr(match[7] ?? '', 'color') : '';
        tokens.push({
          type: 'tag',
          closing: match[4] === '/',
          tag: tag === 'font' ? 'color' : tag,
          attr,
        });
      }
    }
  }
  if (last < source.length) {
    tokens.push({ type: 'text', value: source.slice(last) });
  }

  interface StackFrame {
    colors: RichColorStop[] | null;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    strike: boolean;
    tag: string;
  }

  const stack: StackFrame[] = [{ colors: null, bold: false, italic: false, underline: false, strike: false, tag: '' }];
  const cur = () => stack[stack.length - 1];
  const pushWith = (patch: Partial<StackFrame>, tag: string) => {
    const top = cur();
    stack.push({
      colors: patch.colors !== undefined ? patch.colors : top.colors,
      bold: patch.bold !== undefined ? patch.bold : top.bold,
      italic: patch.italic !== undefined ? patch.italic : top.italic,
      underline: patch.underline !== undefined ? patch.underline : top.underline,
      strike: patch.strike !== undefined ? patch.strike : top.strike,
      tag,
    });
  };
  const popTag = (tags: string[]) => {
    for (let i = stack.length - 1; i > 0; i--) {
      if (tags.includes(stack[i].tag)) {
        stack.splice(i, 1);
        return;
      }
    }
  };

  const runs: RichNameRun[] = [];
  let sawStyleTag = false;

  for (const tok of tokens) {
    if (tok.type === 'text') {
      if (!tok.value) continue;
      const top = cur();
      const style = {
        colors: top.colors,
        bold: top.bold,
        italic: top.italic,
        underline: top.underline,
        strike: top.strike,
      };
      if (runs.length > 0 && stylesEqual(runs[runs.length - 1], style)) {
        runs[runs.length - 1].text += tok.value;
      } else {
        runs.push({ text: tok.value, ...style });
      }
      continue;
    }

    const { closing, tag, attr } = tok;
    if (tag === 'color' || tag === 'gradient') {
      sawStyleTag = true;
      if (closing) {
        popTag(['color', 'gradient']);
      } else {
        const colors = parseColorList(attr);
        pushWith({ colors: colors.length > 0 ? colors : cur().colors }, tag);
      }
    } else if (tag === 'b') {
      sawStyleTag = true;
      if (closing) popTag(['b']);
      else pushWith({ bold: true }, 'b');
    } else if (tag === 'i') {
      sawStyleTag = true;
      if (closing) popTag(['i']);
      else pushWith({ italic: true }, 'i');
    } else if (tag === 'u') {
      sawStyleTag = true;
      if (closing) popTag(['u']);
      else pushWith({ underline: true }, 'u');
    } else if (tag === 's' || tag === 'strike') {
      sawStyleTag = true;
      if (closing) popTag(['s', 'strike']);
      else pushWith({ strike: true }, tag);
    }
  }

  while (runs.length > 0) {
    runs[0].text = runs[0].text.replace(/^\s+/u, '');
    if (runs[0].text) break;
    runs.shift();
  }
  while (runs.length > 0) {
    const tail = runs[runs.length - 1];
    tail.text = tail.text.replace(/\s+$/u, '');
    if (tail.text) break;
    runs.pop();
  }

  const plain = runs.map((r) => r.text).join('');
  const hasRichStyle = runs.some(
    (r) => (r.colors !== null && r.colors.length > 0) || r.bold || r.italic || r.underline || r.strike,
  );
  return { plain, runs, hasRichStyle, sawStyleTag };
}

export function plainRichGameName(raw: string | null | undefined, fallback = ''): string {
  const plain = parseRichGameName(raw).plain.trim();
  return plain || fallback;
}
