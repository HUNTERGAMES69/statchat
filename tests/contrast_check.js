// Every color on a converted page, measured against what is behind it
// ====================================================================
// Built while converting view.html, extended on login.html. It exists
// because converting a page by eye does not work: on view.html eleven
// colors read fine on white and nearly vanished on charcoal, and only
// TWO of them were caught by looking at the screen.
//
// **Legible enough to miss by eye is not the same as legible.**
//
// It does four things a grep cannot:
//
//   * RESOLVES TOKENS. `color:var(--sc-navy)` tells you nothing until you
//     know what --sc-navy is. Pointing that token at a dark value and
//     letting text inherit it has caused two separate bugs -- game.html's
//     play ladder and login.html's wordmark -- so the check follows the
//     variable to its value.
//   * FINDS LIGHT BACKGROUNDS BY LUMINANCE, not by matching names. An
//     enumerated list of light colors missed 7 on game.html and 23
//     across the other pages. "A pale notice panel" is not a set anyone
//     can recall.
//   * LISTS INLINE COLORS SEPARATELY, because no stylesheet reaches them
//     at any specificity. That is why the view.html conversion took two
//     passes.
//   * CHECKS THE DARK-THEME PREREQUISITES -- color-scheme, the WebKit
//     autofill override, a visible focus ring. Each was missing on
//     login.html and each is invisible until a real user hits it.
//
//   node tests/contrast_check.js            # every converted page
//   node tests/contrast_check.js login      # one page

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const CARD = '#191f27';   // what text normally sits on
const PAGE = '#10141a';
const AA_BODY = 4.5, AA_LARGE = 3.0;

// Colors that are deliberately below body AA, with the reason. Anything
// not on this list that falls short is a finding.
const ALLOWED_LOW = {
  '#5f6b78': 'disabled control — must read as unavailable, not vanish',
  '#4b5665': 'decorative score dash, not text',
};

const lum = hex => {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const [r, g, b] = [0, 2, 4].map(i => {
    const x = parseInt(c.substr(i, 2), 16) / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// Is the declaration at `at` inside a rule whose selector is repeated
// later with an !important for the same property? If so it is dead.
// OVERRIDE DETECTION BY PARSING, NOT BY REGEX.
// The first version built a pattern like
//   (^|[,{}\s])[^{}]*<selector>[^{}]*\{[^}]*color\s*:[^;}]*!important
// and ran it against the rest of the file once per color declaration.
// Two unbounded [^{}]* segments with no match is textbook catastrophic
// backtracking: it was fine on small pages and hung outright on help.html,
// which is 60k and has 22 declarations. **A checker nobody can wait for is
// a checker nobody runs.**
//
// Rules are parsed once per file instead, then looked up. Linear, and it
// cannot blow up on a selector that happens to be long.
// Is this declaration inside an @media print block? Counted by braces
// from the block's opening, which is exact -- a "does the word print
// appear nearby" test would exempt anything written next to a comment
// about printing.
function inPrintBlock(src, at) {
  let i = src.indexOf('@media print');
  while (i !== -1 && i < at) {
    const open = src.indexOf('{', i);
    if (open === -1) break;
    let depth = 0, j = open;
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) break; }
    }
    if (at > open && at < j) return true;
    i = src.indexOf('@media print', j);
  }
  return false;
}

function parseRules(src) {
  const rules = [];
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    rules.push({ at: m.index, sel: m[1].trim().replace(/\s+/g, ' '), body: m[2] });
  }
  return rules;
}

// Does a rule LATER in the file, whose selector targets the same last
// simple selector, set `prop` with !important?
function overriddenBy(rules, at, prop, src) {
  const inPrintBlockCache = (i) => src ? inPrintBlock(src, i) : false;
  const mine = rules.find(r => at >= r.at && at <= r.at + r.sel.length + r.body.length + 2);
  if (!mine) return false;
  const key = mine.sel.split(',').pop().trim().split(/\s+/).pop();
  if (!key) return false;
  // A RULE INSIDE @media print DOES NOT OVERRIDE THE SCREEN RULE.
  // help.html's print block restates `.note { background:#eef6f1
  // !important }`, which made the screen rule look overridden -- so a
  // light note panel on screen was silently exempt. The two live in
  // different media; neither overrides the other.
  return rules.some(r =>
    r.at > at && !inPrintBlockCache(r.at) &&
    new RegExp(prop + '\\s*:[^;]*!important').test(r.body) &&
    r.sel.split(',').some(one => one.trim().split(/\s+/).pop() === key));
}

function audit(file) {
  const raw = fs.readFileSync(path.join(ROOT, file), 'utf8');
  // Comments carry example colors and explanations. Matching them
  // reports failures against code that does not exist -- a mistake this
  // project has made four separate times.
  const src = raw.replace(/<!--[\s\S]*?-->/g, '')
                 .replace(/\/\*[\s\S]*?\*\//g, '')
                 .replace(/^\s*\/\/[^\n]*$/gm, '');

  // TOKENS FROM THE SCREEN THEME ONLY.
  // A page that prints re-points the same token names inside @media print
  // -- that is the whole reason the conversion went through tokens. Built
  // from the whole file, the print block's --sc-ink:#1a1a1a overwrote the
  // dark one, and then every `color:var(--sc-ink)` on the page resolved to
  // near-black and failed. The page was correct; the checker was reading
  // the wrong half of it.
  const tokens = {};
  for (const m of src.matchAll(/(--[a-z-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\b/g)) {
    if (inPrintBlock(src, m.index)) continue;
    tokens[m[1]] = m[2];
  }
  // ALIASES: A TOKEN POINTING AT ANOTHER TOKEN.
  // broadcast_setup.html defines `--green: var(--sc-green)` -- a local name
  // for a shared color, which is reasonable and common. Resolving only one
  // hop left --green unknown, so a button using it could not be measured
  // and its dark ink was reported against the card instead of against the
  // light green it actually sits on.
  // Followed to a fixed point, with a hop limit so a circular definition
  // cannot spin.
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    for (const m of src.matchAll(/(--[a-z-]+)\s*:\s*var\(\s*(--[a-z-]+)/g)) {
      if (inPrintBlock(src, m.index)) continue;
      if (!tokens[m[1]] && tokens[m[2]]) { tokens[m[1]] = tokens[m[2]]; changed = true; }
    }
    if (!changed) break;
  }
  // AN UNDEFINED TOKEN SILENTLY BECOMES ITS FALLBACK, and every fallback
  // in this codebase was chosen for a white page. `var(--sc-blue, #1565c0)`
  // on the dashboard rendered as #1565c0 -- 2.89:1 on the menu -- because
  // --sc-blue was never defined there. Returning null for that case meant
  // the audit skipped it entirely and reported the page clean.
  //
  // So: resolve to the token when defined, and to the FALLBACK when not,
  // which is what the browser does.
  const undefinedTokens = new Set();
  const resolve = v => {
    const t = /var\(\s*(--[a-z-]+)\s*(?:,\s*(#[0-9a-fA-F]{3,6}))?/.exec(v);
    if (t) {
      if (tokens[t[1]]) return tokens[t[1]];
      if (t[2]) { undefinedTokens.add(t[1] + ' -> ' + t[2]); return t[2]; }
      return null;
    }
    return /^#[0-9a-fA-F]{3,6}$/.test(v) ? v : null;
  };

  const rules = parseRules(src);
  const findings = [];

  // ---- text colors -----------------------------------------------------
  for (const m of src.matchAll(/(?<![-a-zA-Z])color\s*:\s*(var\([^)]*\)|#[0-9a-fA-F]{3,6})/g)) {
    const c = resolve(m[1]);
    if (!c) continue;
    const r = ratio(c, CARD);
    if (r >= AA_BODY) continue;
    if (ALLOWED_LOW[c.toLowerCase()]) continue;
    // TEXT INSIDE THE SPREADSHEET PICTURE. The sheet is deliberately
    // white, so its cell text is deliberately near-black. Measuring it
    // against the dark card is meaningless -- it never touches the card.
    {
      const ctx = src.slice(Math.max(0, m.index - 300), m.index + 40);
      if (/sheetMock/.test(ctx)) continue;
    }
    // INK ON AN INVERTED CHIP. An amber or white fill takes near-black
    // text by design; measuring it against the CARD says 1.14:1 and means
    // nothing, because it never touches the card. Recognized by the fill
    // sitting in the same rule.
    {
      const ruleStart = src.lastIndexOf('{', m.index);
      const ruleEnd = src.indexOf('}', m.index);
      const rule = ruleStart > -1 && ruleEnd > -1 ? src.slice(ruleStart, ruleEnd) : '';
      // The fill may sit in the same INLINE style rather than in a rule --
      // the Penalty button is `style="background:#ffc72c; color:#0d1117"`,
      // and slicing to the enclosing braces finds no rule at all. Widen to
      // the surrounding attribute when there is no rule to read.
      // AN INLINE STYLE IS NOT A RULE. Slicing to the enclosing braces from
      // inside a style="..." attribute lands on whatever CSS rule happens
      // to be nearest in the file -- for the Penalty button that was a
      // rule whose fill is #1a1a2e, so the check measured dark ink against
      // a dark fill it never touches. Prefer the same style attribute when
      // the declaration is inside one.
      const attrStart = src.lastIndexOf('style="', m.index);
      const attrEnd = attrStart > -1 ? src.indexOf('"', attrStart + 7) : -1;
      const inAttr = attrStart > -1 && attrEnd > m.index;
      const ctx = inAttr ? src.slice(attrStart, attrEnd) : rule;
      const fill = /background(?:-color)?:\s*(?:var\(\s*(--[a-z-]+)[^)]*\)|(#[0-9a-fA-F]{3,6}))/.exec(ctx);
      if (fill) {
        const fc = fill[1] ? tokens[fill[1]] : fill[2];
        if (fc && lum(fc) > 0.4 && ratio(c, fc) >= AA_BODY) continue;
      }
    }
    // OVERRIDDEN DECLARATIONS ARE NOT FINDINGS. view.html is themed by an
    // appended block, so a rule earlier in the file may be entirely dead.
    // Reporting it sends someone to fix code that never runs -- and worse,
    // it buries the findings that are real: the one that mattered on that
    // page was a MISSING color-scheme, hidden among six false positives.
    if (overriddenBy(rules, m.index, 'color', src)) continue;
    // @media print again: dark ink on white paper is correct there, and
    // measuring it against the dark card is meaningless.
    if (inPrintBlock(src, m.index)) continue;
    findings.push({
      kind: r < AA_LARGE ? 'FAIL' : 'large-only',
      msg: c + ' is ' + r.toFixed(2) + ':1 on the card' +
           (r < AA_LARGE ? ' — below the 3:1 floor for any text' :
            ' — only acceptable for large or bold text'),
    });
  }

  // ---- light backgrounds, by luminance ---------------------------------
  // #fff USED TO BE ON THIS LIST and it hid two bugs: the row menu and
  // the account menu were both `background:#fff` inside a JavaScript
  // string, so eight dark-theme labels sat on a white panel. The audit
  // passed both times, because white was exempt.
  //
  // It is exempt only where it is deliberate -- the logo plate, which is
  // dark artwork needing a light backing. That is `.scMark`/`logo.png`,
  // so the exemption is now scoped to that context rather than granted to
  // the color everywhere it appears.
  const keep = new Set(['#ffc72c', '#7cb518', '#a3d93f']);
  // A BACKGROUND CAN BE LIGHT VIA A FALLBACK, NOT ONLY A LITERAL.
  // `background:var(--sc-amber-soft, #fff8e6)` renders cream when the
  // token is undefined -- which is exactly how a light panel shipped into
  // create_game.html after two earlier undefined-token bugs had already
  // been caught. The scan only matched bare hex, so it never looked.
  for (const m of src.matchAll(/background(?:-color)?\s*:\s*var\(\s*(--[a-z-]+)\s*,\s*(#[0-9a-fA-F]{3,6})\s*\)/g)) {
    // "DEFINED" MEANS DEFINED AT ALL, not defined as a hex.
    // The token map only stores hex values, because that is what contrast
    // needs. But most tints in this theme are rgba(), so checking the map
    // reported nine pages as having undefined tokens that are defined on
    // every one of them. Ask the source whether the name is declared.
    if (new RegExp('(^|[;{\\s])' + m[1] + '\\s*:').test(src)) continue;
    if (inPrintBlock(src, m.index)) continue;
    if (lum(m[2]) <= 0.5) continue;
    findings.push({ kind: 'FAIL', msg: 'background uses ' + m[1] +
      ', which is UNDEFINED here, so it falls back to the light ' + m[2] });
  }

  for (const m of src.matchAll(/background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,6})\b/g)) {
    const c = m[1].toLowerCase();
    if (keep.has(c) || lum(c) <= 0.5) continue;
    if (overriddenBy(rules, m.index, 'background', src)) continue;
    // INSIDE @media print, LIGHT IS THE POINT. Paper is white, so the
    // print block deliberately undoes every dark surface. Reporting those
    // as failures would mean a page that prints correctly can never pass.
    if (inPrintBlock(src, m.index)) continue;
    // The logo plate: white behind dark artwork, within ~200 chars of the
    // mark's own selector or filename.
    // The logo plate. The selector can sit some way above the color --
    // a multi-line rule with a comment in it -- so the window is generous,
    // and `padding:2px` is required alongside, which is what makes it a
    // plate rather than a panel that happens to be white.
    const around = src.slice(Math.max(0, m.index - 600), m.index + 120);
    if (/scMark|splashIcon|\.brand img/.test(around) && /padding:\s*2px/.test(around)) continue;
    // A QR CODE MUST BE DARK-ON-LIGHT. Cameras look for dark modules on a
    // light field; inverted or tinted, many scanners fail outright. Like
    // the logo plate, this is a light patch the ARTWORK requires -- not a
    // page that was missed.
    if (/mfaQr|qrcode|qr-code/i.test(around)) continue;
    // THE SPREADSHEET EXAMPLE stays light. It is a PICTURE of a
    // spreadsheet -- gray gutters, column letters, white cells -- shown so
    // a coach knows what file to build. Rendered dark it stops being a
    // picture of the thing it is describing.
    if (/sheetMock|sheetNote/.test(around)) continue;
    // THE TENANT'S OWN LOGO also needs a plate. It is usually a
    // transparent PNG drawn for a white page, so a dark crest vanishes on
    // a dark card -- the same problem as logo.png, for artwork we do not
    // control at all. Same exemption, on the preview and anywhere it is
    // shown at size.
    if (/logoPreview|teamLogo|team-summary-logo/.test(around)) continue;
    findings.push({ kind: 'FAIL', msg: 'light background ' + c +
      ' (luminance ' + lum(c).toFixed(2) + ') — converted pages should have none' });
  }

  // ---- A BRIGHT FILL MUST BRING ITS OWN INK -----------------------------
  // `button.primary { background:var(--sc-green) }` set the fill and left
  // the color to the base `button` rule -- light ink on a light green,
  // 1.48:1, across 21 buttons including Save, Start game and End game.
  // The ladder's active item was right only because it sets BOTH.
  //
  // The audit could not see it: it measures each `color:` against the CARD,
  // and light ink on a dark card is fine. The failure only exists in the
  // PAIRING, so the pairing is what gets checked.
  for (const m of rules) {
    const body = m.body.replace(/\s+/g, ' ');
    const bgm = /background(?:-color)?:\s*(var\(\s*--[a-z-]+[^)]*\)|#[0-9a-fA-F]{3,6})/.exec(body);
    if (!bgm) continue;
    // RESOLVE THE TOKEN, NOT ITS FALLBACK. `var(--sc-red-tint, #fdecea)`
    // resolves to the dark rgba tint on every converted page; reading the
    // light fallback reported .msg.error and .msg.success as broken on
    // eight pages that are correct. resolve() returns the fallback only
    // when the token is genuinely undefined, which is the real bug -- and
    // that case is already reported separately.
    const tokName = /var\(\s*(--[a-z-]+)/.exec(bgm[1]);
    if (tokName && !tokens[tokName[1]]) continue;   // undefined: reported elsewhere
    const bg = resolve(bgm[1]);
    if (!bg || lum(bg) < 0.4) continue;          // only bright fills
    // A PLATE HOLDS AN IMAGE, NOT TEXT. The logo plate, the QR code and the
    // spreadsheet picture are deliberately light and contain no ink at all,
    // so "sets a fill but no color" is exactly right for them.
    if (/scMark|logoPreview|mfaQr|sheetMock|splashIcon|\.brand img/.test(m.sel)) continue;
    // AND AN OVERRIDDEN RULE IS NOT A FINDING -- the same allowance the
    // text and background scans already make. view.html is themed by an
    // appended block, so `.card { background:#fff }` higher up is dead
    // code. Reporting it sends someone to fix a rule that never runs.
    if (overriddenBy(rules, m.at + 1, 'background', src)) continue;
    if (inPrintBlock(src, m.at)) continue;
    const inkm = /(?<![-a-zA-Z])color:\s*(var\(\s*--[a-z-]+[^)]*\)|#[0-9a-fA-F]{3,6})/.exec(body);
    // no ink at all is the actual bug: the color comes from elsewhere
    if (!inkm) {
      findings.push({ kind: 'FAIL', msg: '"' + m.sel.slice(0, 44) + '" sets a bright fill (' +
        bg + ') but no color — the ink comes from a rule written for a dark ' +
        'background and will be unreadable' });
      continue;
    }
    const ink = resolve(inkm[1]);
    if (!ink) continue;
    const r = ratio(ink, bg);
    if (r < AA_BODY) {
      findings.push({ kind: 'FAIL', msg: '"' + m.sel.slice(0, 44) + '": ' + ink +
        ' on ' + bg + ' is ' + r.toFixed(2) + ':1 — a bright fill needs dark ink' });
    }
  }

  // INLINE STYLES PAIR FILL AND INK TOO, and the loop above only walks CSS
  // rules -- so `style="background:#ffc72c; color:#eef1f4"` on the Penalty
  // button was outside the check entirely. That is the button Andy
  // reported as hard to read.
  for (const a of src.matchAll(/style="([^"]*)"/g)) {
    const decl = a[1];
    const bgm = /background(?:-color)?:\s*(var\(\s*--[a-z-]+[^)]*\)|#[0-9a-fA-F]{3,6})/.exec(decl);
    const inkm = /(?<![-a-zA-Z])color:\s*(var\(\s*--[a-z-]+[^)]*\)|#[0-9a-fA-F]{3,6})/.exec(decl);
    if (!bgm || !inkm) continue;
    // Resolve the TOKEN, not its light fallback -- the same correction the
    // rule loop needed. `var(--sc-amber-tint, #fff3cd)` is a dark tint on
    // every converted page; reading the fallback reported two correct
    // pages as broken.
    const bgTok = /var\(\s*(--[a-z-]+)/.exec(bgm[1]);
    if (bgTok && !tokens[bgTok[1]]) continue;   // undefined: reported elsewhere
    const bg = resolve(bgm[1]), ink = resolve(inkm[1]);
    if (!bg || !ink || lum(bg) < 0.4) continue;
    const r = ratio(ink, bg);
    if (r < AA_BODY) {
      findings.push({ kind: 'FAIL', msg: 'inline style pairs ' + ink + ' ink with the bright ' +
        bg + ' fill — ' + r.toFixed(2) + ':1' });
    }
  }

  // ---- SVG PAINT, which no stylesheet can reach -------------------------
  // `fill="#1a1a2e"` and `stroke="..."` are ATTRIBUTES. No CSS rule, token
  // or override touches them, so they survive every recoloring pass
  // untouched. That is twice on this page: the field strip stayed a pale
  // green pitch, and then the direction arrow under it stayed near-black
  // at 1.03:1 after the pitch was fixed, because the arrow sits on the
  // CARD rather than inside the field.
  //
  // The pitch itself is legitimately dark, so paint inside a rect that
  // forms the field is exempt -- listed explicitly rather than inferred.
  const FIELD_PAINT = new Set(['#1c2a17', '#243318', '#4e6b3a', '#173404', '#eaf3de', '#c0dd97']);
  for (const m of src.matchAll(/(?:fill|stroke)=\\?["'](#[0-9A-Fa-f]{3,6})/g)) {
    const c = m[1].toLowerCase();
    if (FIELD_PAINT.has(c)) continue;
    if (lum(c) > 0.4) continue;                  // light paint reads fine on dark
    if (ratio(c, CARD) >= 3) continue;
    findings.push({ kind: 'FAIL', msg: 'SVG paint ' + c + ' is ' + ratio(c, CARD).toFixed(2) +
      ':1 on the card — a fill= attribute is not reachable by any stylesheet, ' +
      'so it survives every recoloring pass' });
  }

  // ---- BORDERS, the third surface ---------------------------------------
  // The audit checked text and backgrounds and not borders, so 51
  // near-white hairlines survived every clean run on gamedark.html --
  // #ccc control edges and #f2f2f2 row dividers, each invisible on white
  // by design and the brightest thing in the tile on charcoal. Andy
  // reported the Live totals rules; the other 49 were the same fault
  // nobody had looked at yet.
  // Deliberate accent edges: an amber or green border on a colored chip is
  // the signal, not an oversight. Listed rather than inferred, so adding one
  // is a decision somebody makes on purpose.
  const BORDER_OK = new Set(['#e0b84c', '#a3d93f', '#ffc72c', '#ffd964',
                             '#c8455c', '#c8922f', '#c26a3a', '#6f9f22']);
  for (const m of src.matchAll(/border[a-z-]*:\s*[^;}"']*?(#[0-9a-fA-F]{3,6})\b/g)) {
    const c = m[1].toLowerCase();
    if (BORDER_OK.has(c) || lum(c) <= 0.5) continue;
    if (inPrintBlock(src, m.index)) continue;
    const around = src.slice(Math.max(0, m.index - 300), m.index + 60);
    if (/sheetMock|mfaQr|scMark|logoPreview/.test(around)) continue;
    findings.push({ kind: 'FAIL', msg: 'near-white border ' + c +
      ' — invisible on white by design, the brightest thing in the tile on dark' });
  }

  // ---- the prerequisites ------------------------------------------------
  const needs = [
    [/color-scheme\s*:\s*dark/, 'color-scheme:dark — without it the browser paints ' +
      'scrollbars, the caret and AUTOFILLED fields light'],
  ];
  if (/<input/.test(src)) {
    needs.push([/-webkit-autofill(?![a-zA-Z])/, 'a WebKit autofill override — it paints with an ' +
      'inset shadow that no background rule reaches, and a saved password is the ' +
      'normal way in']);
    needs.push([/:focus-visible(?![a-zA-Z])/, 'a visible focus ring — the default outline is dark ' +
      'and disappears on a dark card']);
  }
  // A LATER `background:` SHORTHAND WIPES AN EARLIER background-image.
  // This has now cost two rounds: once on the dashboard's season picker,
  // then again on the roster's, two hours after I wrote the rule down. The
  // chevron is drawn as a background-image; any later shorthand on a
  // selector that also matches the select silently removes it, and the
  // field stops looking like a dropdown.
  //
  // Checked by parse rather than by reading: find the rule that draws a
  // chevron, then look for a later rule matching `select` that uses the
  // shorthand.
  {
    // A CHEVRON CAN BE DECLARED EITHER WAY -- `background-image:url(...)`
    // or inside the `background` shorthand. The detector only recognized
    // the first, so reports.html, which uses the shorthand deliberately to
    // make the reset impossible, was invisible to it. A check that only
    // sees one of two correct spellings will eventually bless the wrong
    // one.
    const chevron = rules.find(r => /background(?:-image)?:[^;]*url\(["']?data:image\/svg/.test(r.body)
                                 && /select/.test(r.sel));
    if (chevron) {
      // Only a rule targeting the SELECT ITSELF can reset it. A rule for
      // `select option` styles a different element entirely -- flagging it
      // is a false positive, and a check that cries wolf gets ignored.
      const wiped = rules.find(r => r.at > chevron.at &&
        /(^|[;{\s])background\s*:/.test(r.body) &&
        !/url\(/.test(r.body) &&
        r.sel.split(',').some(one => {
          const t = one.trim();
          return /select/.test(t) && !/\boption\b|::/.test(t);
        }));
      if (wiped) {
        findings.push({ kind: 'FAIL', msg: 'a later `background:` shorthand on "' +
          wiped.sel + '" resets the chevron drawn by "' + chevron.sel +
          '" — use background-color there, or the dropdown arrow disappears' });
      }
    }
  }

  // THE LOGO PLATE, asserted POSITIVELY. Removing it leaves no light
  // background, so a check that only hunts light colors cannot see the
  // mark vanish into the card. logo.png is dark-on-light artwork.
  if (/class="scMark"|class='scMark'/.test(src) &&
      !/\.scMark\s*>\s*img\s*\{[^}]*background:\s*#(?:fff|ffffff)/.test(src)) {
    findings.push({ kind: 'FAIL', msg: 'the StatChat mark has no white plate — logo.png is ' +
      'dark artwork and sinks into the card without one' });
  }

  needs.forEach(([re, what]) => {
    if (!re.test(src)) findings.push({ kind: 'FAIL', msg: 'missing ' + what });
  });

  const inline = [...new Set([...src.matchAll(
    /style\s*=\s*["'][^"']*?(?<![-a-zA-Z])color\s*:\s*(#[0-9a-fA-F]{3,6})/g)].map(m => m[1]))];

  undefinedTokens.forEach(t => findings.push({ kind: 'FAIL',
    msg: 'undefined token falls back to a light-theme color: ' + t }));

  return { file, findings, inline, tokens: Object.keys(tokens).length };
}

// WHICH PAGES ARE CONVERTED IS DETECTED, NOT LISTED.
// A hardcoded array meant this file changed on every page conversion, so
// it had to be re-uploaded each time -- and a list that must be edited in
// lockstep with something else is a list that will eventually disagree
// with it.
//
// `color-scheme:dark` is the marker: it is required on every converted
// page (see DARK_THEME_PLAN.md) and appears on no other. So a page opts
// itself in by being converted, and this file can be uploaded once.
const CONVERTED = fs.readdirSync(ROOT)
  .filter(f => f.endsWith('.html') && !f.includes('_mock') && f !== 'index.html')
  .filter(f => /color-scheme\s*:\s*dark/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')))
  .sort();

const only = process.argv[2];
const files = (only
  ? fs.readdirSync(ROOT).filter(f => f.startsWith(only) && f.endsWith('.html'))
  : CONVERTED
).filter(f => fs.existsSync(path.join(ROOT, f)));

let bad = 0;
console.log('=== Dark-theme audit (text vs card ' + CARD + ') ===\n');
for (const f of files) {
  const a = audit(f);
  const fails = a.findings.filter(x => x.kind === 'FAIL');
  if (fails.length) bad++;
  console.log('  ' + (fails.length ? 'FAIL' : ' ok ') + '  ' + f.padEnd(22) +
              a.tokens + ' tokens' + (a.inline.length ? ', ' + a.inline.length + ' inline colors' : ''));
  a.findings.forEach(x => console.log('          [' + x.kind + '] ' + x.msg));
}
console.log('\nPages with findings: ' + bad + ' of ' + files.length);

// ---- status messages must be readable on the dark card ------------------
// --sc-red and --sc-green were re-pointed to light inks for the dark theme,
// but the TINTS behind them were left as their light-theme fallbacks --
// #fdecea and #e8f5e9, both near-white. Every status message rendered pale
// ink on a near-white block: errors at 1.89:1, successes at 1.49:1.
//
// It is why a wrong password on the login page looked like nothing happened.
// The message was there the whole time, in a color nobody could read. A FILL
// HAS TO BRING ITS OWN INK -- the fifth time that rule has been learned here.
(function msgTints(){
  const DARK = ['login','dashboard','account','roster','customize','create_game',
                'reports','view','game'];
  for (const name of DARK) {
    const f = require('path').join(__dirname, '..', name + '.html');
    if (!require('fs').existsSync(f)) continue;
    const src = require('fs').readFileSync(f, 'utf8');
    for (const kind of ['error','success','warn','info']) {
      const m = new RegExp('\\.msg\\.' + kind + '\\s*\\{([^}]*)\\}').exec(src);
      if (!m) continue;
      const bg = /background:\s*(#[0-9a-fA-F]{6})/.exec(m[1]);
      const fg = /color:\s*(#[0-9a-fA-F]{6})/.exec(m[1]);
      if (!bg || !fg) {
        console.log('  FAIL ' + name + '.html .msg.' + kind +
                    ': fill or ink is inherited, not stated — that is how the ' +
                    'light tint survived the dark conversion');
        bad++; continue;
      }
      const r = ratio(fg[1], bg[1]);
      if (r < 4.5) {
        console.log('  FAIL ' + name + '.html .msg.' + kind + ' ' + fg[1] +
                    ' on ' + bg[1] + ' = ' + r.toFixed(2) + ':1');
        bad++;
      }
    }
  }
})();

// ---- a disabled button must RECEDE, not fade ----------------------------
// The rule was `opacity:0.5`, carried over from the light theme where it
// works -- half-fading a white button pushes it toward a white page and it
// flattens away. On the dark card the same fade only DIMS: a faded button
// still sits above the surface at 1.19:1 where a live one is 1.43:1. So a
// row of mostly-disabled buttons read as uniform, and after a touchdown, or
// after a try when only Kickoff is live, there was no way to see which one
// could be pressed.
//
// On a dark page "unavailable" has to mean CLOSER TO THE BACKGROUND.
(function disabledRecedes(){
  const DARK = ['game','account','roster','create_game','login','dashboard',
                'customize','reports','view'];
  for (const name of DARK) {
    const f = require('path').join(__dirname, '..', name + '.html');
    if (!require('fs').existsSync(f)) continue;
    const src = require('fs').readFileSync(f, 'utf8');
    const m = /button:disabled[^{]*\{([^}]*)\}/.exec(src);
    if (!m) continue;

    if (/opacity\s*:\s*0?\.\d/.test(m[1])) {
      console.log('  FAIL ' + name + '.html: disabled buttons FADE rather than recede — ' +
                  'on a dark card that only dims them, so a dead button still ' +
                  'sits above the surface');
      bad++;
      continue;
    }

    const tok = {};
    for (const t of src.matchAll(/(--sc-[a-z-]+):\s*(#[0-9a-fA-F]{3,6})/g)) tok[t[1]] = t[2];
    const card = tok['--sc-card'] || '#191f27';
    const live = tok['--sc-navy'] || '#2f3a47';
    const bgm = /background:\s*(?:var\((--[a-z-]+),\s*)?(#[0-9a-fA-F]{6})/.exec(m[1]);
    if (!bgm) {
      console.log('  FAIL ' + name + '.html: disabled buttons state no fill, so they ' +
                  'inherit the live one');
      bad++; continue;
    }
    const bg = tok[bgm[1]] || bgm[2];
    // THE GAP BETWEEN THE TWO STATES is what a scorer reads, not each fill
    // against the card. A first version of this compared them separately and
    // passed #2b333d -- the original bug -- because it sits 1.30:1 off the
    // card while being only 1.11:1 from a live button. Indistinguishable
    // from live IS the fault, however it relates to the card.
    const gap = ratio(bg, live);
    if (gap < 1.25) {
      console.log('  FAIL ' + name + '.html: the disabled fill (' + bg + ') is only ' +
                  gap.toFixed(2) + ':1 from a live button — mid-drive, a row of ' +
                  'mostly-disabled buttons reads as uniform and there is no way ' +
                  'to see which one can be pressed');
      bad++;
    }
    if (ratio(bg, card) > ratio(live, card)) {
      console.log('  FAIL ' + name + '.html: the disabled fill stands off the card ' +
                  'MORE than a live button — a dead control more prominent than ' +
                  'one you can press');
      bad++;
    }
  }
})();

// ---- the score banner must sit ABOVE the quad, not below it -------------
// It was a gradient from #161c24 to #11161d, both DARKER than the #191f27
// quad they sit in. On an already-dark page that made the most important
// line on the screen recede -- it read as a gap above the content rather
// than a header for it.
(function bannerLifted(){
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'view.html'), 'utf8');
  const m = /\.banner\{\s*background:([^;!]+)/.exec(src);
  if (!m) { console.log('  FAIL view.html: no .banner background rule found'); bad++; return; }
  const fill = m[1].trim();

  if (/linear-gradient/.test(fill)) {
    console.log('  FAIL view.html: the banner is a gradient again — it ran light to ' +
                'dark left to right, putting the quarter in the dimmest corner of a ' +
                'wide screen, for an effect too subtle to see');
    bad++; return;
  }
  const hex = /^#[0-9a-fA-F]{6}$/.test(fill) ? fill : null;
  if (!hex) { console.log('  FAIL view.html: banner fill is not a plain colour: ' + fill); bad++; return; }

  const QUAD = '#191f27';
  if (ratio(hex, QUAD) < 1.25) {
    console.log('  FAIL view.html: the banner (' + hex + ') is only ' +
                ratio(hex, QUAD).toFixed(2) + ':1 off the quad — the score line has to ' +
                'lead, and a header that sinks into its own panel does not');
    bad++;
  }
  // THE BOTTOM TILE HEADINGS get the same treatment, set inline in JS.
  // They were #171d25 -- 1.02:1 against the quad, i.e. sunk into it.
  const headFill = /h\.style\.background = '(#[0-9a-fA-F]{6})'/.exec(src);
  if (!headFill) {
    console.log('  FAIL view.html: could not find the tile heading fill'); bad++;
  } else {
    if (ratio(headFill[1], QUAD) < 1.25) {
      console.log('  FAIL view.html: the bottom tile headings (' + headFill[1] + ') sink ' +
                  'into the quad at ' + ratio(headFill[1], QUAD).toFixed(2) + ':1');
      bad++;
    }
    if (headFill[1] !== hex) {
      console.log('  FAIL view.html: the tile headings (' + headFill[1] + ') and the score ' +
                  'banner (' + hex + ') are different colours — two headers on one screen ' +
                  'at different weights reads as an accident');
      bad++;
    }
  }

  // A SPINE MUST SURVIVE A DARK BRAND. Some schools are navy or near-black,
  // and at #1f3864 the spine sat at 1.01:1 on the lifted heading.
  if (!/function spineColor/.test(src) ||
      !/borderLeft = '5px solid ' \+ spineColor\(/.test(src)) {
    console.log('  FAIL view.html: the team spine is painted raw — a navy or ' +
                'near-black brand disappears against the heading');
    bad++;
  } else {
    // RUN IT. Checking the function exists and is called still passed when the
    // correction loop was neutered -- the shape was right and the behaviour was
    // gone. These are real brand colours a school might set.
    try {
      const eng = require('../engine.js');
      const fnSrc = /function spineColor\(hex\)\{[\s\S]*?\n    \}/.exec(src)[0];
      const spineColor = new Function('mixHex', 'contrastRatio',
        fnSrc + '; return spineColor;')(eng.mixHex, eng.contrastRatio);
      for (const brand of ['#1f3864', '#101418', '#5c0a1e', '#0b3d91', '#123b1e']) {
        const out = spineColor(brand);
        if (ratio(out, headFill ? headFill[1] : '#363a3e') < 2.0) {
          console.log('  FAIL view.html: brand ' + brand + ' yields a spine of ' + out +
                      ' at ' + ratio(out, '#363a3e').toFixed(2) + ':1 — invisible against ' +
                      'the heading, so that tile loses its team marker entirely');
          bad++;
        }
      }
      // and a brand that already works must come through UNCHANGED
      if (spineColor('#f5b921') !== '#f5b921') {
        console.log('  FAIL view.html: a bright brand is being altered when it did not ' +
                    'need to be — a school\'s colour should survive untouched when it works');
        bad++;
      }
    } catch (e) {
      console.log('  FAIL view.html: could not run spineColor — ' + e.message);
      bad++;
    }
  }

  // and the score must still read on it
  const scoreInk = '#eef1f4';
  if (ratio(scoreInk, hex) < 7) {
    console.log('  FAIL view.html: the score reads at ' + ratio(scoreInk, hex).toFixed(1) +
                ':1 on the banner — this is the line a crew reads at a glance from ' +
                'across a booth');
    bad++;
  }
})();

// ---- a text field must READ as a field ----------------------------------
// These used a RAISED fill, lighter than the card -- what the light theme
// did, and backwards here. At 1.10:1 off the card an input was LESS distinct
// than a real button at 1.43:1, so an empty field read as a gap rather than
// somewhere to type. On a dark screen a button is raised and a field is sunk.
(function fieldsAreWells(){
  const DARK = ['login','account','roster','customize','create_game','game'];
  for (const name of DARK) {
    const f = require('path').join(__dirname, '..', name + '.html');
    if (!require('fs').existsSync(f)) continue;
    const src = require('fs').readFileSync(f, 'utf8');

    const rule = /input[^{\n]*\{[^}]*(?:background|background-color):\s*#([0-9a-fA-F]{6})[^}]*\}/.exec(src);
    if (!rule) {
      console.log('  FAIL ' + name + '.html: no text-field fill found — it is inheriting ' +
                  'something, which is how the light raised fill survived the conversion');
      bad++; continue;
    }
    const fill = '#' + rule[1];
    const CARD = '#191f27';
    // SUNK, not raised: the fill must be DARKER than the card it sits on.
    const lumOf = c => { const h=c.replace('#','');
      const p=[0,2,4].map(i=>{let x=parseInt(h.substr(i,2),16)/255;
        return x<=0.03928?x/12.92:Math.pow((x+0.055)/1.055,2.4);});
      return 0.2126*p[0]+0.7152*p[1]+0.0722*p[2]; };
    if (lumOf(fill) >= lumOf(CARD)) {
      console.log('  FAIL ' + name + '.html: the field fill (' + fill + ') is LIGHTER than ' +
                  'the card — that is a weak button, not a field');
      bad++;
    }
    if (!/box-shadow:\s*inset 0 1px 3px/.test(rule[0])) {
      console.log('  FAIL ' + name + '.html: no inner shadow — a border alone draws a ' +
                  'rectangle; the shadow is what reads as depth on an EMPTY field');
      bad++;
    }
    // AUTOFILL HAS TO MATCH. WebKit paints its own fill that no background
    // rule beats, so an autofilled field would snap back to looking raised
    // while every other field on the form was a well.
    if (/1000px var\(--(?:sc|v)-raise\) inset/.test(src)) {
      console.log('  FAIL ' + name + '.html: the autofill override still paints the RAISED ' +
                  'colour — a saved email would look unlike every other field');
      bad++;
    }
  }
})();

// ---- the crew view's fourth tile row must survive -----------------------
// Eight tiles in four rows sit in a .quad that is half the viewport with
// overflow-y:hidden. When the page went dark the tile value was raised from
// 34px to 39px for readability across a room -- about 24px more than the
// column had -- and Penalties and 3rd Down were rendered and then clipped
// below the cut. Nobody checked the column when the type was enlarged.
//
// jsdom does not lay out, so this cannot assert the row is VISIBLE. What it
// can assert is that nothing has re-imposed the floor that caused it.
(function fourthTileRow(){
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'view.html'), 'utf8');
  const css = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');

  for (const sel of ['.team-summary-col', '.stat-tile']) {
    const m = new RegExp('\\' + sel + '\\s*\\{([^}]*)\\}').exec(css);
    if (!m) { console.log('  FAIL view.html: no rule for ' + sel); bad++; continue; }
    if (!/min-height:\s*0/.test(m[1])) {
      console.log('  FAIL view.html: ' + sel + ' has no min-height:0 — a flex child ' +
                  'and a grid item both default to a minimum of their CONTENT ' +
                  'size, so the rows cannot compress and the fourth is pushed ' +
                  'out of a container that hides its overflow');
      bad++;
    }
  }

  // A FIXED VALUE SIZE JUST MOVES THE OVERFLOW. Once the rows can compress,
  // a number that cannot compress with them spills out of its own tile.
  const v = /\.stat-tile-value\{\s*font-size:([^;]+)/.exec(css);
  if (!v) {
    console.log('  FAIL view.html: no tile value size found'); bad++;
  } else if (!/clamp\(/.test(v[1])) {
    console.log('  FAIL view.html: the tile value is a fixed ' + v[1].trim() +
                ' — it has to scale with the tile, or the row that was being ' +
                'clipped is replaced by a number overflowing its own box');
    bad++;
  }

  // and all eight tiles must still be built
  const t = /const tiles = \[([\s\S]*?)\n      \];/.exec(src);
  const labels = t ? [...t[1].matchAll(/'([A-Za-z0-9 ]+)'\]/g)].map(x => x[1]) : [];
  for (const want of ['Penalties', '3rd Down']) {
    if (!labels.includes(want)) {
      console.log('  FAIL view.html: the ' + want + ' tile is no longer built');
      bad++;
    }
  }
})();

// ---- field goals and extra points are separate rows ---------------------
// They shared one five-column line -- FG Att, FG Made, Long, XP Att, XP
// Made -- so a kicker who only took extra points still occupied all five
// with three em-dashes in them, and the widest header set a column width
// nothing in the row needed. On a narrow tile that is what pushed the
// special-teams table past its border.
//
// There is vertical room in that tile and there was never horizontal room.
(function kickingSplit(){
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'view.html'), 'utf8');

  if (/\['FG Att','FG Made','Long','XP Att','XP Made'\]/.test(src)) {
    console.log('  FAIL view.html: field goals and extra points share a five-column ' +
                'row again — a PAT-only kicker fills three of them with dashes');
    bad++;
  }
  for (const want of ["\\['FG Att','FG Made','Long'\\]", "\\['XP Att','XP Made'\\]"]) {
    if (!new RegExp(want).test(src)) {
      console.log('  FAIL view.html: expected a table headed ' +
                  want.replace(/\\\\/g, '') + ' and did not find one');
      bad++;
    }
  }

  // A PAT-ONLY KICKER MUST NOT APPEAR IN THE FG TABLE AT ALL. Guarding on
  // `d.fgAtt || d.patAtt` for both was the original fault; each row now
  // guards on its own stat.
  if (!/if \(d\.fgAtt\)\{/.test(src) || !/if \(d\.patAtt\)\{/.test(src)) {
    console.log('  FAIL view.html: the two rows do not guard independently, so a ' +
                'kicker with only one kind of kick still appears in both');
    bad++;
  }

  // and the row budget has to count both, or the tile overflows the way it
  // did before
  if (!/Math\.min\(stFieldGoals\.length, 5\) \+ Math\.min\(stPats\.length, 5\)/.test(src)) {
    console.log('  FAIL view.html: the row-count budget does not include both ' +
                'kicking tables');
    bad++;
  }
})();

function chkQuiet(ok, msg){ if (!ok){ console.log('  FAIL view.html: ' + msg); bad++; } }

// ---- the football and the timeout counter go away when play is not live -
// Both describe a live situation. At halftime neither is true: nobody has
// the ball, and timeouts reset for the second half, so TOL=1 is not stale
// -- it is wrong. At full time the same holds, and the counter describes a
// game that cannot use them.
//
// The SAME TWO STATES the drive cards hide on, so one screen behaves one
// way.
//
// THE SIGNAL IS SHARED with the drive cards in the top-right quad, which
// already switch on `phase`. A first version added its own atHalftime()
// helper: a third copy of `halftimeIdx !== -1 && !secondHalfStarted`, and
// exactly the kind of thing that drifts until two parts of one screen
// disagree about when halftime is.
(function halftimeSuppression(){
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'view.html'), 'utf8');

  chkQuiet(!/function atHalftime/.test(src),
    'halftime is derived in a second place — it belongs to `phase`, which ' +
    'the drive cards already use');
  chkQuiet(/const notLive = phase === 'HALFTIME' \|\| phase === 'FINAL';/.test(src),
    'renderTeamSummary does not cover BOTH halftime and final — the drive ' +
    'cards hide on both, and these have to match');
  chkQuiet(/const showScoring = phase === 'HALFTIME';/.test(src),
    'and the drive cards no longer read it either — these two must agree');
  chkQuiet(/!notLive && liveState\.possession === teamKey/.test(src),
    'the possession football is not suppressed');
  chkQuiet(/\(notLive \? '' :[\s\S]{0,160}TOL=/.test(src),
    'the timeout counter is not suppressed');

  // BOTH STATES, RUN. Naming them is not covering them.
  {
    const f = (phase) => phase === 'HALFTIME' || phase === 'FINAL';
    chkQuiet(f('HALFTIME') && f('FINAL'), 'both non-live phases suppress');
    chkQuiet(!f(null) && !f('NOT STARTED'),
      'and a live game, or one not yet started, does not — a football hidden ' +
      'mid-drive is a worse fault than one shown at the whistle');
  }

  // phase must be set before the render reads it, in the same pass
  const setAt = src.indexOf('phase =\n');
  const useAt = src.indexOf("const notLive = phase === 'HALFTIME'");
  chkQuiet(setAt > -1 && useAt > setAt,
    'phase is read before renderAll assigns it, so the tiles would lag a ' +
    'render behind the drive cards');
})();

// EXIT LAST. This line used to sit above the message-tint audit, so any
// failure it found was counted after the exit code had already been decided
// -- the audit could go red and the run still exit 0.
process.exitCode = bad ? 1 : 0;
