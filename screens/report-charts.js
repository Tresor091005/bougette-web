// Les dessins des rapports (2026-11-27, avec l'utilisateur : reproduit de Money Lover) : l'anneau des catégories (parts
// de la teinte de la catégorie, icône et pourcentage au bout d'un trait), les barres par sous-période (entrées au-dessus
// de la ligne zéro, sorties dessous) et la courbe cumulée du mois contre la moyenne. SVG à la main, sans bibliothèque ;
// les couleurs viennent des jetons de theme.css (--cN, --gain, --loss, --accent-text, --ink-2, --line, --rule), le style
// de screens.css (.rp-*). Les icônes sont du HTML posé sur le dessin (une icône de catégorie n'est pas un dessin SVG).
import { moneyShort, money, esc } from '../core/format.js';
import { chip } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { percents, axisFor } from '../domain/report.js';

const f1 = (/** @type {number} */ v) => v.toFixed(1);

/**
 * Une courbe lissée par des points (Catmull-Rom vers Bézier, sans dépasser) : « M x,y C … », ou juste « M x,y » pour un
 * point. Aussi celle de la tuile Rythme de l'accueil.
 * @param {number[][]} p
 */
export function smoothPath(p) {
  if (p.length < 2) return p.length ? `M${f1(p[0][0])},${f1(p[0][1])}` : '';
  let d = `M${f1(p[0][0])},${f1(p[0][1])}`;
  for (let i = 0; i < p.length - 1; i++) {
    const [x0, y0] = p[i - 1] || p[i], [x1, y1] = p[i], [x2, y2] = p[i + 1], [x3, y3] = p[i + 2] || p[i + 1];
    const c1 = [x1 + (x2 - x0) / 6, Math.min(Math.max(y1 + (y2 - y0) / 6, Math.min(y1, y2)), Math.max(y1, y2))];
    const c2 = [x2 - (x3 - x1) / 6, Math.min(Math.max(y2 - (y3 - y1) / 6, Math.min(y1, y2)), Math.max(y1, y2))];
    d += ` C${f1(c1[0])},${f1(c1[1])} ${f1(c2[0])},${f1(c2[1])} ${f1(x2)},${f1(y2)}`;
  }
  return d;
}

/**
 * @typedef {{ id: string|null, amount: number, tint: string, name: string, cat: any }} Part
 * id : la catégorie principale (null : sans catégorie) ; tint : « c3 »… (la teinte de la catégorie) ; cat : la catégorie
 * (pour son icône), null si elle n'en a pas.
 */

/**
 * L'anneau : une part par catégorie principale, de sa teinte, de petits espaces entre les parts, des coins nets ; en grand
 * (big), les parts assez grandes portent leur icône dans une pastille de leur teinte, au bout d'un trait, avec leur
 * pourcentage ; le total est au centre. Sans rien, un anneau gris.
 * @param {Part[]} parts @param {{ big?: boolean, total?: number, cur?: string }} [o]
 */
export function donutHTML(parts, { big = false, total = 0, cur = undefined } = {}) {
  const W = big ? 320 : 120, H = big ? 336 : 120, cx = W / 2, cy = big ? 168 : 60;
  const R = big ? 84 : 56, r = big ? 50 : 34, rm = (R + r) / 2, th = R - r;
  const sum = parts.reduce((s, p) => s + p.amount, 0);
  const pct = percents(parts.map(p => p.amount));
  const pt = (/** @type {number} */ a, /** @type {number} */ rad) => [cx + rad * Math.sin(a), cy - rad * Math.cos(a)];
  const gap = (big ? 3 : 2.5) / rm;
  let a = 0, shapes = '';
  const marks = [];
  parts.forEach((p, i) => {
    const sweep = (p.amount / sum) * 2 * Math.PI, mid = a + sweep / 2;
    const stroke = `var(--${p.tint || 'c0'})`;
    if (parts.length === 1) shapes += `<circle data-part data-id="${esc(p.id || '')}" cx="${cx}" cy="${cy}" r="${rm}" fill="none" stroke="${stroke}" stroke-width="${th}"/>`;
    else {
      const a0 = a + gap / 2, a1 = Math.max(a0 + 0.01, a + sweep - gap / 2);
      const [x0, y0] = pt(a0, rm), [x1, y1] = pt(a1, rm);
      shapes += `<path data-part data-id="${esc(p.id || '')}" d="M${f1(x0)},${f1(y0)} A${rm},${rm} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${f1(x1)},${f1(y1)}" fill="none" stroke="${stroke}" stroke-width="${th}"/>`;
    }
    marks.push({ i, mid, share: p.amount / sum });
    a += sweep;
  });
  // les icônes : les plus grosses parts d'abord, jamais deux trop proches (la pastille et son pourcentage doivent tenir)
  let badges = '', lines = '';
  if (big && sum > 0) {
    const kept = /** @type {number[]} */ ([]);
    for (const m of [...marks].sort((x, y) => y.share - x.share)) {
      if (m.share < 0.04 || pct[m.i] < 1 || kept.some(k => Math.abs(Math.atan2(Math.sin(marks[k].mid - m.mid), Math.cos(marks[k].mid - m.mid))) < 0.34)) continue;
      kept.push(m.i);
    }
    for (const i of kept.sort((x, y) => x - y)) {
      const p = parts[i], m = marks[i];
      const [x0, y0] = pt(m.mid, R), [x1, y1] = pt(m.mid, R + 36 - 15), [px, py] = pt(m.mid, R + 36), [tx, ty] = pt(m.mid, R + 36 + 26);
      lines += `<line x1="${f1(x0)}" y1="${f1(y0)}" x2="${f1(x1)}" y2="${f1(y1)}" stroke="var(--${p.tint || 'c0'})" stroke-width="1.5"/>`;
      const at = (/** @type {number} */ x, /** @type {number} */ y) => `left:${((x / W) * 100).toFixed(2)}%;top:${((y / H) * 100).toFixed(2)}%`;
      badges += `<span class="rp-badge" data-badge="${esc(p.id || '')}" style="${at(px, py)}">${p.cat ? chip(p.cat, 'sm') : `<span class="pill sm acc">${icon('tag')}</span>`}</span>`
        + `<span class="rp-pct" style="${at(tx, ty)}">${pct[i]} %</span>`;
    }
  }
  const ring = sum > 0 ? shapes : `<circle cx="${cx}" cy="${cy}" r="${rm}" fill="none" stroke="var(--rule)" stroke-width="${th}"/>`;
  const label = sum > 0 ? parts.map((p, i) => `${p.name} ${pct[i]} %`).join(', ') : 'Aucune opération';
  return `<div class="rp-donut${big ? ' big' : ''}" role="img" aria-label="${esc(label)}">
    <svg viewBox="0 0 ${W} ${H}" aria-hidden="true" data-donut>${lines}${ring}</svg>${badges}${big ? `<div class="rp-mid"><span>Total</span><b>${esc(money(total, { cur }))}</b></div>` : ''}</div>`;
}

/**
 * Des barres par sous-période : up au-dessus de la ligne zéro, down dessous (up seul pour un graphique simple). Une ligne de
 * grille et son montant court tous les pas de l'axe ; les noms des périodes dessous (penchés au-delà de 7).
 * @param {{ short: string, up: number, down?: number }[]} items @param {{ cur?: string, upCls?: string, downCls?: string }} [o]
 */
export function barsHTML(items, { cur = undefined, upCls = 'gain', downCls = 'loss' } = {}) {
  const W = 320, L = 44, top = 8, tilt = items.length > 7, plotH = 150, H = top + plotH + (tilt ? 36 : 26);
  const { step, hi, lo } = axisFor(Math.max(0, ...items.map(x => x.up)), Math.max(0, ...items.map(x => x.down || 0)));
  const unit = plotH / (hi + lo), y0 = top + hi * unit, slot = (W - L) / Math.max(1, items.length), bw = Math.min(slot * 0.62, 40);
  let g = '';
  for (let v = -lo; v <= hi; v += step) {
    const y = y0 - v * unit;
    g += `<line class="${v === 0 ? 'zero' : 'grid'}" x1="${L}" x2="${W}" y1="${f1(y)}" y2="${f1(y)}"/><text class="ax" x="${L - 6}" y="${f1(y + 4)}" text-anchor="end">${esc(v === 0 ? '0' : moneyShort(v, { cur }).replace(/\s*(F|FCFA)$/, ''))}</text>`;
  }
  let bars = '', names = '';
  items.forEach((x, i) => {
    const cx = L + slot * (i + 0.5);
    if (x.up > 0) bars += `<rect class="${upCls}" data-bar x="${f1(cx - bw / 2)}" y="${f1(y0 - x.up * unit)}" width="${f1(bw)}" height="${f1(Math.max(1.5, x.up * unit))}" rx="2"/>`;
    if ((x.down || 0) > 0) bars += `<rect class="${downCls}" data-bar x="${f1(cx - bw / 2)}" y="${f1(y0)}" width="${f1(bw)}" height="${f1(Math.max(1.5, (x.down || 0) * unit))}" rx="2"/>`;
    const ly = top + plotH + 16;
    names += tilt ? `<text class="ax" x="${f1(cx)}" y="${ly}" text-anchor="end" transform="rotate(-40 ${f1(cx)} ${ly})">${esc(x.short)}</text>`
      : `<text class="ax" x="${f1(cx)}" y="${ly}" text-anchor="middle">${esc(x.short)}</text>`;
  });
  return `<svg class="rp-bars" viewBox="0 0 ${W} ${H}" aria-hidden="true" data-bars>${g}${bars}${names}</svg>`;
}

/**
 * La courbe cumulée : la période en trait épais d'accent jusqu'à aujourd'hui (un point dessus), la moyenne des périodes
 * d'avant en gris sur toute la durée (un point à la même date) ; le repère vertical à aujourd'hui, dessous la date du
 * début, celle d'aujourd'hui et celle de la fin.
 * @param {{ now: number[], avg: number[], n: number, start: string, end: string, at: string }} o
 */
export function curveHTML({ now, avg, n, start, end, at }) {
  const W = 320, H = 130, pad = 6;
  const max = Math.max(1, ...now, ...avg) * 1.08;
  const x = (/** @type {number} */ i) => pad + (i / Math.max(1, n - 1)) * (W - 2 * pad);
  const y = (/** @type {number} */ v) => H - pad - (v / max) * (H - 2 * pad);
  const pts = (/** @type {number[]} */ c) => c.map((v, i) => [x(i), y(v)]);
  const last = now.length - 1;
  const mark = last >= 0 && last < n;
  const dot = (/** @type {string} */ cls, /** @type {number} */ v) => `<circle class="${cls}" cx="${f1(x(last))}" cy="${f1(y(v))}" r="4.5"/>`;
  const pos = mark ? (x(last) / W) * 100 : 0;
  return `<svg class="rp-curve" viewBox="0 0 ${W} ${H}" aria-hidden="true" data-curve>
    <line class="base" x1="${pad}" x2="${W - pad}" y1="${H - pad}" y2="${H - pad}"/>
    ${mark ? `<line class="tick" x1="${f1(x(last))}" x2="${f1(x(last))}" y1="${pad}" y2="${H - pad}"/>` : ''}
    <path class="avg" d="${smoothPath(pts(avg))}"/>
    <path class="now" d="${smoothPath(pts(now))}"/>
    ${mark ? dot('avg', avg[Math.min(last, avg.length - 1)] || 0) + dot('now', now[last]) : ''}
  </svg>
  <div class="rp-axis"><span>${esc(start)}</span>${mark && pos > 16 && pos < 84 ? `<span class="at" style="left:${pos.toFixed(1)}%">${esc(at)}</span>` : ''}<span>${esc(end)}</span></div>`;
}
