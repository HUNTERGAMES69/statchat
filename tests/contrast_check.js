// Every colour on a converted page, measured against what is behind it
// ====================================================================
// Built while converting view.html, extended on login.html. It exists
// because converting a page by eye does not work: on view.html eleven
// colours read fine on white and nearly vanished on charcoal, and only
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
//     enumerated list of light colours missed 7 on game.html and 23
//     across the other pages. "A pale notice panel" is not a set anyone
//     can recall.
//   * LISTS INLINE COLOURS SEPARATELY, because no stylesheet reaches them
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

// Colours that are deliberately below body AA, with the reason. Anything
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
// and ran it against the rest of the file once per colour declaration.
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
  // Comments carry example colours and explanations. Matching them
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
  // for a shared colour, which is reasonable and common. Resolving only one
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

  // ---- text colours -----------------------------------------------------
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
    // nothing, because it never touches the card. Recognised by the fill
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
  // the colour everywhere it appears.
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
    // The logo plate. The selector can sit some way above the colour --
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
    // spreadsheet -- grey gutters, column letters, white cells -- shown so
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
  // the colour to the base `button` rule -- light ink on a light green,
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
    // so "sets a fill but no colour" is exactly right for them.
    if (/scMark|logoPreview|mfaQr|sheetMock|splashIcon|\.brand img/.test(m.sel)) continue;
    // AND AN OVERRIDDEN RULE IS NOT A FINDING -- the same allowance the
    // text and background scans already make. view.html is themed by an
    // appended block, so `.card { background:#fff }` higher up is dead
    // code. Reporting it sends someone to fix a rule that never runs.
    if (overriddenBy(rules, m.at + 1, 'background', src)) continue;
    if (inPrintBlock(src, m.at)) continue;
    const inkm = /(?<![-a-zA-Z])color:\s*(var\(\s*--[a-z-]+[^)]*\)|#[0-9a-fA-F]{3,6})/.exec(body);
    // no ink at all is the actual bug: the colour comes from elsewhere
    if (!inkm) {
      findings.push({ kind: 'FAIL', msg: '"' + m.sel.slice(0, 44) + '" sets a bright fill (' +
        bg + ') but no colour — the ink comes from a rule written for a dark ' +
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

  // ---- BORDERS, the third surface ---------------------------------------
  // The audit checked text and backgrounds and not borders, so 51
  // near-white hairlines survived every clean run on gamedark.html --
  // #ccc control edges and #f2f2f2 row dividers, each invisible on white
  // by design and the brightest thing in the tile on charcoal. Andy
  // reported the Live totals rules; the other 49 were the same fault
  // nobody had looked at yet.
  // Deliberate accent edges: an amber or green border on a coloured chip is
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
    // or inside the `background` shorthand. The detector only recognised
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
  // background, so a check that only hunts light colours cannot see the
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
    msg: 'undefined token falls back to a light-theme colour: ' + t }));

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
              a.tokens + ' tokens' + (a.inline.length ? ', ' + a.inline.length + ' inline colours' : ''));
  a.findings.forEach(x => console.log('          [' + x.kind + '] ' + x.msg));
}
console.log('\nPages with findings: ' + bad + ' of ' + files.length);
process.exitCode = bad ? 1 : 0;
