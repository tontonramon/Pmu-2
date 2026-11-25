// Détermine, pour chaque course de courses.json, la forme de pari la plus intéressante.
// Usage : node paris.js        -> écrit paris.json et affiche un résumé
// Méthode : probabilités du marché (cotes) légèrement corrigées par la forme et les gains,
// puis modèle de Plackett-Luce pour estimer la probabilité de chaque type de pari
// (jouer les N meilleurs chevaux du modèle) et son rapport probable.
const fs = require("fs");

const CFG = {
  wF: 0.3, wG: 0.1,          // poids forme / gains (comme dans la page)
  tilt: 0.5,                 // force de la correction du marché (0 = marché pur ; au-delà de 1, les écarts deviennent irréalistes)
  minProba: 0.04,            // on ignore les paris réussis moins de 4 fois sur 100
  takeout: { SIMPLE_GAGNANT: .25, SIMPLE_PLACE: .25, COUPLE_GAGNANT: .28, COUPLE_PLACE: .28,
             TRIO: .30, TIERCE: .30, QUARTE_PLUS: .30, QUINTE_PLUS: .30 },   // prélèvements approximatifs
  defaut: ["SIMPLE_GAGNANT", "SIMPLE_PLACE", "COUPLE_GAGNANT", "COUPLE_PLACE"], // si la course ne liste pas ses paris
};
const NOMS = { SIMPLE_GAGNANT: "Simple gagnant", SIMPLE_PLACE: "Simple placé", COUPLE_GAGNANT: "Couplé gagnant",
  COUPLE_PLACE: "Couplé placé", TRIO: "Trio (désordre)", TIERCE: "Tiercé (désordre)", QUARTE_PLUS: "Quarté+ (désordre)", QUINTE_PLUS: "Quinté+ (désordre)" };
const NB = { SIMPLE_GAGNANT: 1, SIMPLE_PLACE: 1, COUPLE_GAGNANT: 2, COUPLE_PLACE: 2, TRIO: 3, TIERCE: 3, QUARTE_PLUS: 4, QUINTE_PLUS: 5 };

// ---------- forme (identique à la page) ----------
const PTS = { 1: 10, 2: 8, 3: 6, 4: 4, 5: 2 };
function forme(m) {
  m = (m || "").replace(/\([^)]*\)/g, "");
  const t = [...m.matchAll(/([0-9]+|[A-Za-z])([a-z])/g)].slice(0, 5);
  if (!t.length) return 0;
  return t.reduce((s, x) => s + (/^\d+$/.test(x[1]) ? (PTS[+x[1]] || 0) : 0), 0) / t.length;
}

// ---------- Plackett-Luce ----------
function perms(a) { if (a.length <= 1) return [a]; return a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map(r => [x, ...r])); }
function seq(order, p) { let rest = 1, pr = 1; for (const i of order) { if (rest <= 1e-12) return 0; pr *= p[i] / rest; rest -= p[i]; } return pr; }
const ensemble = (p, S) => perms(S).reduce((t, o) => t + seq(o, p), 0);       // S = les |S| premiers, dans n'importe quel ordre
function dansTop(p, idx, m) {                                                  // idx termine dans les m premiers
  let total = 0;
  (function rec(used, d, pr, rest) {
    if (d === m) return;
    for (let i = 0; i < p.length; i++) {
      if (used.has(i)) continue;
      const q = pr * p[i] / rest;
      if (i === idx) { total += q; continue; }
      used.add(i); rec(used, d + 1, q, rest - p[i]); used.delete(i);
    }
  })(new Set(), 0, 1, 1);
  return total;
}
function deuxDansTop(p, a, b, m) {                                             // a et b terminent tous deux dans les m premiers
  let total = 0;
  (function rec(used, d, pr, rest, fa, fb) {
    if (fa && fb) { total += pr; return; }
    if (d === m) return;
    for (let i = 0; i < p.length; i++) {
      if (used.has(i)) continue;
      const q = pr * p[i] / rest;
      used.add(i); rec(used, d + 1, q, rest - p[i], fa || i === a, fb || i === b); used.delete(i);
    }
  })(new Set(), 0, 1, 1, false, false);
  return total;
}
function proba(pari, p, picks, n) {
  const m = n >= 8 ? 3 : 2;
  switch (pari) {
    case "SIMPLE_GAGNANT": return p[picks[0]];
    case "SIMPLE_PLACE": return n >= 4 ? dansTop(p, picks[0], m) : null;
    case "COUPLE_GAGNANT": return n >= 3 ? ensemble(p, picks.slice(0, 2)) : null;
    case "COUPLE_PLACE": return n >= 8 ? deuxDansTop(p, picks[0], picks[1], 3) : null;
    case "TRIO": case "TIERCE": return n >= 4 ? ensemble(p, picks.slice(0, 3)) : null;
    case "QUARTE_PLUS": return n >= 5 ? ensemble(p, picks.slice(0, 4)) : null;
    case "QUINTE_PLUS": return n >= 6 ? ensemble(p, picks.slice(0, 5)) : null;
  }
  return null;
}

// ---------- analyse d'une course ----------
function analyser(c) {
  const R = c.runners, n = R.length;
  const sp = R.reduce((s, r) => s + 1 / r.cote, 0);
  const pm = R.map(r => (1 / r.cote) / sp);                                    // probabilités du marché
  const f = R.map(r => forme(r.musique)), mg = Math.max(...R.map(r => r.gains)) || 1;
  const g = R.map(r => r.gains / mg * 10);
  const mf = f.reduce((a, b) => a + b, 0) / n, mgm = g.reduce((a, b) => a + b, 0) / n;
  let pr = R.map((_, i) => pm[i] * Math.exp(CFG.tilt * (CFG.wF * (f[i] - mf) + CFG.wG * (g[i] - mgm)) / 10 * 5));
  const sm = pr.reduce((a, b) => a + b, 0); pr = pr.map(x => x / sm);          // probabilités du modèle
  const ordre = R.map((_, i) => i).sort((a, b) => pr[b] - pr[a]);              // chevaux classés par le modèle
  const dispo = (c.paris && c.paris.length ? c.paris : CFG.defaut).filter(k => NOMS[k]);
  const cand = [];
  for (const k of dispo) {
    const picks = ordre.slice(0, NB[k]);
    if (picks.length < NB[k]) continue;
    const Pm = proba(k, pr, picks, n), Pk = proba(k, pm, picks, n);
    if (!Pm || !Pk) continue;
    const t = CFG.takeout[k];
    cand.push({ pari: k, nom: NOMS[k], chevaux: picks.map(i => R[i].n).sort((a, b) => a - b),
      noms: picks.map(i => R[i].nom), proba: +Pm.toFixed(4), rapport: +((1 - t) / Pk).toFixed(2), valeur: +((1 - t) * Pm / Pk).toFixed(3) });
  }
  const ok = cand.filter(x => x.proba >= CFG.minProba).sort((a, b) => b.valeur - a.valeur || b.proba - a.proba);
  const reste = cand.filter(x => x.proba < CFG.minProba);
  return { meilleur: ok[0] || cand.find(x => x.pari === "SIMPLE_GAGNANT") || null, autres: ok.slice(1).concat(reste) };
}

// ---------- programme principal ----------
const J = JSON.parse(fs.readFileSync("courses.json", "utf8"));
const out = { date: J.date, courses: {} };
for (const c of J.courses) {
  const a = analyser(c);
  if (!a.meilleur) continue;
  out.courses[c.key] = a;
  const b = a.meilleur;
  console.log(`${c.key} ${c.hippo} ${c.heure} : ${b.nom} ${b.chevaux.join("-")}  réussite ${(b.proba * 100).toFixed(1)} %  rapport ≈ ${b.rapport} €  valeur ${b.valeur}`);
}
fs.writeFileSync("paris.json", JSON.stringify(out));
console.log(Object.keys(out.courses).length + " courses analysées -> paris.json");
