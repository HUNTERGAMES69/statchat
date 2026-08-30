// Copyright 2026 StatChat. All rights reserved.
// Unauthorized copying, modification or distribution of this software
// or its documentation is prohibited.

// The defensive picker stacks number over name
// ============================================
// Reported after a live game, 27 August 2026: the defensive picker took so
// much height it forced scrolling. It grows as tacklers are discovered --
// twenty-odd by the third quarter -- and side by side that is four rows,
// which pushes Review play off the screen.
//
// Stacked it is three rows, 139px against 180px, and the number reads
// larger relative to the name, which is what a scorer searching for a
// jersey number actually wants.
//
// 72px WIDE, NOT NARROWER. A 52px slot saves twice as much but clips
// Robicheaux and Thibodeaux; 62px still clips Robicheaux once the button
// padding is taken off. Measured against 28 Louisiana surnames, 72 is
// where none of them truncate. A truncated name is worse than no name --
// it still looks like a check and is not one.
//
//   node tests/picker_stacked_check.js

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'game.html'), 'utf8');

let fails = 0;
const chk = (o, m) => { console.log((o ? '  ok   ' : '  FAIL ') + m); if (!o) fails++; };

console.log('=== Defensive picker: stacked layout ===\n');

const m = /function pickerHtml\(list, groupClass, statLabelFn, emptyMsg, stackLayout\)\{[\s\S]*?\n\}/.exec(src);
chk(!!m, 'pickerHtml takes an explicit stackLayout argument');
const pickerHtml = new Function('shortPickerName', m[0] + '; return pickerHtml;')(
  n => String(n || '').split(' ').pop());

const LIST = [{ num:'55', name:'Chase Robicheaux' }, { num:'7', name:'Ty Carter' }];
const stacked = (cls, flag) => /flex-direction:column/.test(
  pickerHtml(LIST, cls, null, null, flag));

// ---- THE CALLER DECIDES, not the class name -----------------------------
// This first keyed off /^pp_credit_pick/, which looked like "the defensive
// picker" and was not: the same class is used by a returner picker and by a
// recovery credit that renders SPECIAL TEAMS when the kicking team came up
// with the ball. A change asked for on one picker landed on three, and the
// test passed because it checked which classes stacked rather than which
// lists they render.
chk(stacked('pp_credit_pick', true), 'stacking follows the argument');
chk(!stacked('pp_credit_pick', false), 'and not the class name');
chk(!stacked('pp_credit_pick'), 'omitting it means flat, so nothing stacks by accident');

// ---- exactly the two defensive call sites opt in ------------------------
chk(/pickerHtml\(list, 'pp_credit_pick' \+ suffix, null, null, true\)/.test(src),
    'the tackled-by picker, whose list is defenseEligible, stacks');
chk(/pickerHtml\(list, 'pp_credit_pick' \+ suffix, null, null, !kicking\)/.test(src),
    'and the recovery credit stacks only when it is showing defenders — the ' +
    'same control renders special teams when the kicking team recovered');
chk(/pickerHtml\(list, 'pp_credit_pick' \+ suffix, \(num, p\) => \(p && p\.pos\) \|\| '',/.test(src),
    'the returner picker is left flat, since its list is returnerEligible');

{
  // COUNTED BY PARSING THE ARGUMENTS, not by matching a shape. The first
  // version required "null, null," before the flag, so a flag added to the
  // returner call -- which passes a statLabelFn and so reads "…, null,
  // true," -- slipped straight past it. Found by mutation, not by reading.
  // WALK THE PARENTHESES. A regex capture stopped at the first ')' it found,
  // which on the returner call is the one inside its arrow function
  // `(num, p) =>` -- so the argument list was truncated before the flag and
  // a mutation adding one there went unnoticed. Found by mutation testing;
  // reading the regex would not have shown it.
  const calls = [];
  let at = src.indexOf('pickerHtml(');
  while (at !== -1){
    let i = at + 'pickerHtml('.length, depth = 1;
    while (i < src.length && depth > 0){
      const c = src[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      if (depth > 0) i++;
    }
    calls.push(src.slice(at + 'pickerHtml('.length, i));
    at = src.indexOf('pickerHtml(', i);
  }
  const callArgs = calls
    // the DEFINITION matches this too, and its stackLayout parameter read
    // as a call site asking to stack.
    .filter(a => !/groupClass, statLabelFn/.test(a))
    .filter(a => /^(list|kickerList|returnerList)\b/.test(a));

  const asks = callArgs.filter(a => {
    // SPLIT ON TOP-LEVEL COMMAS ONLY. A statLabelFn is an arrow function
    // with its own comma -- `(num, p) => ...` -- so a plain split put the
    // 5th argument in the wrong place and counted a flag that was not there.
    const parts = [];
    let depth = 0, cur = '';
    for (const ch of a){
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      if (ch === ',' && depth === 0){ parts.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) parts.push(cur.trim());
    const fifth = parts[4];
    return fifth && fifth !== 'null' && fifth !== 'false' && fifth !== 'undefined';
  });
  chk(asks.length === 2,
      'exactly two call sites ask to stack, counted by argument position ' +
      '(found ' + asks.length + ')');
  chk(asks.every(a => /'pp_credit_pick'/.test(a)),
      'and both are credit pickers');
}

// ---- the width is the whole point ---------------------------------------
{
  const html = pickerHtml(LIST, 'pp_credit_pick', null, null, true);
  chk(/min-width:72px/.test(html),
      'the button is 72px wide — 62 still clips Robicheaux once padding is ' +
      'taken off, and that was measured, not guessed');
  chk(/max-width:72px/.test(html), 'and the name box matches it');
  chk(/font-size:17px/.test(m[0]),
      'the number is 17px, larger relative to the name than side by side');
  chk(/font-size:12px; opacity:0\.74/.test(m[0]),
      'and the name is 12px — 9.5px was unreadable in a press box');
}

// ---- nothing is lost -----------------------------------------------------
{
  const html = pickerHtml(LIST, 'pp_credit_pick', null, null, true);
  chk(/title="Chase Robicheaux"/.test(html),
      'the full name is still on the button as a title, for a roster with ' +
      'two Robinsons');
  chk(/data-num="55"/.test(html), 'and the jersey number is still the data');
  chk(/>Robicheaux</.test(html),
      'with the surname shown, not truncated at this width');
}

// ---- a stat label still fits --------------------------------------------
{
  const html = pickerHtml(LIST, 'pp_credit_pick', () => 'LB', null, true);
  chk(/font-size:10px/.test(html) && />LB</.test(html),
      'a position label still renders, one size down to suit the stack');
}

console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
