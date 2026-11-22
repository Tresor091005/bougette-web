// Moi → Monnaie et format : monnaie principale, format des nombres (3 formats prédéfinis) et position du symbole,
// avec un aperçu en direct. Les décimales et le symbole viennent de la devise de chaque montant (symbole, sinon code) :
// pas de réglage pour eux. Changer le format ne modifie jamais les données (montants stockés en entiers).
// Arrondi des estimations (2026-11-12, D0) : le pas de la monnaie principale auquel s'arrondit ce que Bougette estime
// (habitudes, Marge) ; ce qu'elle propose (ce qui manque à une épargne) va au-dessus ; par défaut celui de la table des
// devises, mémorisé par devise.
import { settings, setSettings } from '../core/store.js';
import { money, esc, currency, currencyOf, DEFAULT_FMT, stepChoices, stepOf, approx } from '../core/format.js';
import { icon } from '../core/icons.js';
import { seg, wireSeg, buzz, toast, fitText, $ } from '../core/ui.js';
import { pickCurrency } from './pickers.js';

// Milliers et décimales vont ensemble : espace et virgule (français), point et virgule, virgule et point (anglais).
const FORMAT_SEG = [['space', '1 234,50'], ['dot', '1.234,50'], ['comma', '1,234.50']];
const POS_SEG = [['after', 'Après'], ['before', 'Avant']];

export function render(app, { back, refresh }) {
  const st = settings();
  const c = currency();
  app.innerHTML = `<div class="screen fmt-screen no-tabs">
    <div class="topbar"><div class="left"><button class="iconbtn edge-l" data-back aria-label="Retour">${icon('caret-left')}</button>
      <h1 class="title sm">Monnaie et format</h1></div></div>
    <p class="screen-help">Comment s’affichent tes montants. Tes données ne changent pas.</p>

    <div class="card preview-card" aria-live="polite">
      <div class="eyebrow">Aperçu</div>
      <div class="pv1" data-pv1></div>
      <div class="pv2" data-pv2></div>
      <div class="pv3" data-pv3></div>
    </div>

    <section class="section"><div class="section-h"><span class="eyebrow">Monnaie principale</span></div>
      <div class="group">
        <button class="row" data-cur><span class="pill acc cur-pill">${esc(c.sym)}</span>
          <div class="main"><div class="t">${esc(c.name)}</div><div class="s">${c.code}</div></div><span class="end">${icon('caret-right')}</span></button>
      </div>
      <p class="hint left">Elle sert pour Disponible, les budgets et les totaux. Elle est proposée pour un nouveau portefeuille. Chaque portefeuille garde sa devise.</p>
    </section>

    <section class="section"><div class="section-h"><span class="eyebrow">Estimations</span></div>
      <div class="group plain">
        <div class="row stack"><div class="t">Arrondir à</div>${seg(stepChoices(c.code).map(n => [String(n), money(n, { cur: c.code })]), String(stepOf(c.code)), 's-seg')}</div>
      </div>
      <p class="hint left">Ce que Bougette estime (tes habitudes, la Marge) est arrondi à ce pas. Ce qu’elle te propose (un budget, ce qu’il faut mettre de côté) est arrondi au-dessus, à un pas plus grand. Tes opérations et tes soldes restent exacts.</p>
    </section>

    <section class="section"><div class="section-h"><span class="eyebrow">Format</span></div>
      <div class="group plain">
        <div class="row stack"><div class="t">Nombres</div>${seg(FORMAT_SEG, FORMAT_SEG.some(f => f[0] === st.fmt.group) ? st.fmt.group : null, 'g-seg')}</div>
        <div class="row stack"><div class="t">Symbole</div>${seg(POS_SEG, st.fmt.pos, 'p-seg')}</div>
      </div>
      <button class="link reset-fmt" data-reset>Revenir au format par défaut</button>
    </section>
  </div>`;

  paint(app);
  $('[data-back]', app).onclick = () => back('#/reglages');
  const set = patch => setSettings({ fmt: { ...settings().fmt, ...patch } });
  wireSeg($('.g-seg', app), v => set({ group: v }));
  wireSeg($('.p-seg', app), v => set({ pos: v }));
  wireSeg($('.s-seg', app), v => { const code = settings().currency; setSettings({ steps: { ...settings().steps, [code]: Number(v) } }); });
  $('[data-cur]', app).onclick = async () => {
    const code = await pickCurrency({ current: settings().currency, title: 'Monnaie principale' });
    if (!code || code === settings().currency) return;
    // l'écriture est asynchrone : on redessine une fois enregistrée, sinon l'écran montre encore l'ancienne devise
    if (await setSettings({ currency: code })) refresh();
  };
  $('[data-reset]', app).onclick = () => {
    setSettings({ fmt: { ...settings().fmt, group: DEFAULT_FMT.group, pos: DEFAULT_FMT.pos } });
    buzz(10);
    refresh();
    toast('Format par défaut remis');
  };
}

// Aperçu en direct, sans redessiner l'écran (les curseurs gardent leur animation) : la monnaie principale, et une
// devise à centimes pour montrer le séparateur décimal.
function paint(app) {
  const st = settings();
  const c = currencyOf(st.currency);
  const other = c.code === 'EUR' ? 'USD' : 'EUR';
  $('[data-pv1]', app).textContent = money(1234567 * 10 ** c.dec);
  $('[data-pv2]', app).textContent = `${money(-3500 * 10 ** c.dec)} · ${money(123450, { cur: other, sign: true })}`;
  $('[data-pv3]', app).textContent = `Habitudes : ${money(approx(39217 * 10 ** c.dec))} estimés`;
  fitText(app);
}

export function onData(keys) {
  const app = document.getElementById('app');
  if (keys.includes('settings') && $('[data-pv1]', app)) paint(app);
}
