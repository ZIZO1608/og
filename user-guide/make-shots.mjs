// Writes the capture configs (shots-<role>.json) for the user guide.
// Run: node user-guide/make-shots.mjs   — then capture each role with its own login.
import { writeFileSync } from 'node:fs';

const go = (hash, wait = 1600) => [{ eval: `location.hash='#${hash}'` }, { wait }];
const esc = [{ press: 'Escape' }, { wait: 400 }];
const scrollTo = (sel) => ({ eval: `document.querySelector(${JSON.stringify(sel)})?.scrollIntoView({block:'start'})` });

function base(screens, extra = {}) {
  const ready = (lang) => [
    { set_local_storage: { 'og.lang': lang } }, { eval: 'location.reload()' },
    { wait_for: lang === 'ar' ? 'body.rtl' : 'body:not(.rtl)' }, { wait_for: '#bootSplash', optional: true }, { wait: 2500 },
  ];
  return {
    base_url: 'http://localhost:8191',
    display_base_url: 'https://shop.ogsports1.com',
    viewport: { width: 1280, height: 860 },
    device_scale_factor: 2,
    delay_ms: 700,
    css: '#toasts{display:none!important} .mo-glow{display:none!important} .made-by{display:none!important}',
    login: {
      url: '/',
      actions: [{ wait_for: '#lgUser' }, { fill: { selector: '#lgUser', value: '$ENV:GUIDE_USER' } },
        { fill: { selector: '#lgPass', value: '$ENV:GUIDE_PASS' } }, { click: '#lgGo' }],
      wait_for: extra.mobile ? '.tabbtn' : '.user-chip',
    },
    languages: { en: { setup: ready('en') }, ar: { setup: ready('ar') } },
    screens,
    ...extra,
  };
}

// ---------------------------------------------------------------- sign-in screen (no login)
const gate = {
  ...base([]),
  login: undefined,
  languages: {
    en: { setup: [{ set_local_storage: { 'og.lang': 'en' } }, { eval: 'location.reload()' }, { wait_for: '#lgUser' }, { wait: 800 }] },
    ar: { setup: [{ set_local_storage: { 'og.lang': 'ar' } }, { eval: 'location.reload()' }, { wait_for: '#lgUser' }, { wait: 800 }] },
  },
  screens: [{
    id: 'login', url: null, clip: '.gate-card', clip_padding: 16, hide: ['#lgNote'],
    actions: [{ fill: { selector: '#lgUser', value: 'cashier' } }, { fill: { selector: '#lgPass', value: 'xxxxxxxxxx' } }],
    callouts: [{ key: 'user', selector: '#lgUser' }, { key: 'pass', selector: '#lgPass' }, { key: 'eye', selector: '#lgEye' },
      { key: 'go', selector: '#lgGo' }, { key: 'hint', selector: '#lgHint' }],
  }],
};
delete gate.login;

// ---------------------------------------------------------------- owner
const owner = base([
  { id: 'o-home', url: null, actions: go('dashboard'),
    callouts: [{ key: 'menu', selector: '.nav-item[data-view="dashboard"]' }, { key: 'jobs', selector: '.hm-job' },
      { key: 'search', selector: '#globalSearch' }, { key: 'lang', selector: '[data-act="lang"]' },
      { key: 'curr', selector: '[data-act="curr"]' }, { key: 'bell', selector: '[data-act="bell"]' },
      { key: 'acct', selector: '.user-chip' }] },
  { id: 'o-acct', url: null, actions: [{ click: '.user-chip' }, { wait_for: '#acctPop' }, { wait: 400 }],
    clip: '#acctPop', clip_padding: 14,
    callouts: [{ key: 'pw', selector: '[data-act="acct-pw"]' }, { key: 'out', selector: '[data-act="acct-out"]' }] },
  { id: 'o-pw', url: null, actions: [{ click: '[data-act="acct-pw"]' }, { wait_for: '#pwCur' }, { wait: 500 }],
    clip: '.modal', clip_padding: 10,
    callouts: [{ key: 'cur', selector: '#pwCur' }, { key: 'new', selector: '#pwNew' }, { key: 'again', selector: '#pwNew2' },
      { key: 'save', selector: '[data-act="acct-pw-save"]' }] },
  { id: 'o-dash', url: null, actions: [...esc, ...go('dashboard'), scrollTo('.dash-tear'), { wait: 600 }],
    callouts: [{ key: 'scope', selector: '[data-act="dash-scope"], .scope-chips' }] },
  { id: 'o-money-now', url: null, actions: [...go('money'), { click: '[data-mn="group"][data-g="now"]' }, { wait: 1400 }],
    callouts: [{ key: 'groups', selector: '.mn-seg' }, { key: 'hero', selector: '.cb-hero' }, { key: 'move', selector: '[data-cb="move"]' },
      { key: 'expense', selector: '[data-cb="go-expense"]' }, { key: 'close', selector: '[data-cb="go-close"]' },
      { key: 'minor', selector: '.cb-minor' }] },
  { id: 'o-move', url: null, actions: [{ click: '[data-cb="move"] >> nth=0' }, { wait_for: '.modal' }, { wait: 700 }],
    clip: '.modal', clip_padding: 10, callouts: [{ key: 'go', selector: '[data-cb="move-go"]' }] },
  { id: 'o-money-close', url: null, actions: [...esc, { click: '[data-mn="group"][data-g="close"]' }, { wait: 1400 }],
    callouts: [{ key: 'confirm', selector: '[data-cb="dc-confirm"]' }] },
  { id: 'o-expenses', url: null, actions: [{ click: '[data-mn="group"][data-g="out"]' }, { wait: 600 },
      { click: '[data-mn="tab"][data-t="expenses"]' }, { wait: 1200 }],
    callouts: [{ key: 'sub', selector: '.mn-sub' }, { key: 'add', selector: '[data-mn="add-expense"]' }] },
  { id: 'o-expense-add', url: null, actions: [{ click: '[data-mn="add-expense"]' }, { wait_for: '.modal' }, { wait: 600 }],
    clip: '.modal', clip_padding: 10, callouts: [{ key: 'save', selector: '[data-mn="add-expense-go"]' }] },
  { id: 'o-suppliers', url: null, actions: [...esc, { click: '[data-mn="tab"][data-t="suppliers"]' }, { wait: 1400 }],
    callouts: [{ key: 'pay', selector: '[data-py="sup-pay"]' }, { key: 'ledger', selector: '[data-py="sup-ledger"]' }] },
  { id: 'o-sup-pay', url: null, actions: [{ click: '[data-py="sup-pay"]' }, { wait_for: '.modal' }, { wait: 600 }],
    clip: '.modal', clip_padding: 10, callouts: [{ key: 'go', selector: '[data-py="sup-pay-go"]' }] },
  { id: 'o-salaries', url: null, actions: [...esc, { click: '[data-mn="tab"][data-t="salaries"]' }, { wait: 1600 }],
    callouts: [{ key: 'month', selector: '[data-py="pr-month"]' }, { key: 'pay', selector: '[data-py="pr-pay"]' }] },
  { id: 'o-statement', url: null, actions: [{ click: '[data-mn="group"][data-g="books"]' }, { wait: 600 },
      { click: '[data-mn="tab"][data-t="statement"]' }, { wait: 2000 }],
    callouts: [{ key: 'month', selector: '[data-pl="month"]' }] },
  { id: 'o-reports', url: null, actions: go('reports', 2200),
    callouts: [{ key: 'tabs', selector: '[data-act="rep-tab"]' }, { key: 'scope', selector: '[data-act="rep-scope"]' }] },
  { id: 'o-coupons', url: null, actions: go('coupons'), callouts: [{ key: 'new', selector: '[data-act="cpn-new"]' }] },
  { id: 'o-coupon-new', url: null, actions: [{ click: '[data-act="cpn-new"]' }, { wait_for: '#cpnCode' }, { wait: 600 }],
    clip: '.modal', clip_padding: 10,
    callouts: [{ key: 'code', selector: '#cpnCode' }, { key: 'kind', selector: '[data-act="cpn-kind"]' }, { key: 'save', selector: '[data-act="cpn-save"]' }] },
  { id: 'o-payments', url: null, actions: [...esc, ...go('payments', 2000)] },
  { id: 'o-settings', url: null, actions: go('settings', 2000) },
  { id: 'o-staff', url: null, actions: [{ click: '[data-fold="staff"] .fold-btn' }, { wait: 1500 }, { scroll_to: '[data-fold="staff"]' }, { wait: 500 }],
    clip: '[data-fold="staff"]', clip_padding: 8, callouts: [{ key: 'add', selector: '[data-st="add"]' }] },
  { id: 'o-staff-add', url: null, actions: [{ click: '[data-st="add"]' }, { wait_for: '.modal' }, { wait: 700 }],
    clip: '.modal', clip_padding: 10 },
  { id: 'o-rate', url: null, actions: [...esc, { click: '[data-fold="rate"] .fold-btn' }, { wait: 1000 }, { scroll_to: '[data-fold="rate"]' }, { wait: 500 }],
    clip: '[data-fold="rate"]', clip_padding: 8 },
]);

// ---------------------------------------------------------------- manager: the order desk and the road
const manager = base([
  { id: 'm-home', url: null, actions: go('dashboard') },
  { id: 'm-desk-1', url: null, actions: [...go('desk', 2000), { click: '#dkScan' }, { wait_for: '#dkDrop [role="option"]' }, { wait: 500 }],
    callouts: [{ key: 'rail', selector: '#dkRail' }, { key: 'scan', selector: '#dkScan' }, { key: 'list', selector: '#dkDrop [role="option"]' }] },
  { id: 'm-desk-1b', url: null, actions: [{ click: '#dkDrop [role="option"]' }, { wait: 900 }, { press: 'Escape' }, { wait: 300 }],
    callouts: [{ key: 'next', selector: '[data-act="dk-next"]' }] },
  { id: 'm-desk-2', url: null, actions: [{ click: '[data-act="dk-next"]' }, { wait: 700 }, { click: '#dkCust' }, { wait_for: '#dkCustDrop [role="option"]' }, { wait: 400 }],
    callouts: [{ key: 'cust', selector: '#dkCust' }, { key: 'list', selector: '#dkCustDrop [role="option"]' }, { key: 'new', selector: '[data-act="dk-cust-new"]' }] },
  { id: 'm-desk-3', url: null, actions: [{ click: '#dkCustDrop [role="option"]' }, { wait: 700 }, { click: '[data-act="dk-next"]' }, { wait: 700 }],
    callouts: [{ key: 'driver', selector: '[data-act="dk-method"][data-id="driver"]' }, { key: 'pickup', selector: '[data-act="dk-method"][data-id="pickup"]' }] },
  { id: 'm-desk-4', url: null, actions: [{ click: '[data-act="dk-method"][data-id="driver"]' }, { wait: 500 }, { click: '[data-act="dk-next"]' }, { wait: 800 }],
    callouts: [{ key: 'city', selector: '[data-k="city"]' }, { key: 'phone', selector: '[data-k="phone"]' }, { key: 'addr', selector: '[data-k="address"]' },
      { key: 'fee', selector: '[data-change="dk-fee"]' }] },
  { id: 'm-desk-5', url: null, actions: [{ fill: { selector: '[data-k="address"]', value: 'Seryan, Building 12, 3rd floor, near the bakery' } }, { wait: 500 }, { click: '[data-act="dk-next"]' }, { wait: 900 }],
    callouts: [{ key: 'plan', selector: '[data-act="dk-plan"]' }, { key: 'save', selector: '[data-act="dk-save"]' }] },
  { id: 'm-board', url: null, actions: [...go('deliveries', 2200), { click: '[data-act="rd-tab"][data-id="parcels"]', optional: true }, { wait: 1000 }],
    callouts: [{ key: 'tabs', selector: '[data-act="rd-tab"][data-id="parcels"]' }, { key: 'assign', selector: '[data-act="dl-assign"]' },
      { key: 'done', selector: '[data-act="dl-done"]' }, { key: 'menu', selector: '[data-act="dl-menu"]' }] },
  { id: 'm-assign', url: null, actions: [{ click: '[data-act="dl-assign"]' }, { wait_for: '.modal' }, { wait: 800 }], clip: '.modal', clip_padding: 10,
    callouts: [{ key: 'pick', selector: '[data-act="dl-assign-pick"]' }] },
  { id: 'm-menu', url: null, actions: [...esc, { click: '.dlb-card.is-out [data-act="dl-menu"]' }, { wait: 500 }],
    callouts: [{ key: 'pay', selector: '.dlb-card.is-out .dlb-mitem[data-act="dl-pay"]' }, { key: 'back', selector: '.dlb-card.is-out [data-act="rd-return"]' }, { key: 'fail', selector: '.dlb-card.is-out [data-act="dl-fail"]' }] },
  { id: 'm-delivered', url: null, actions: [...esc, { click: '[data-act="dl-done"]' }, { wait_for: '.modal' }, { wait: 700 }], clip: '.modal', clip_padding: 10,
    callouts: [{ key: 'got', selector: '#dlGot' }, { key: 'go', selector: '[data-act="dl-done-go"]' }] },
  { id: 'm-handover', url: null, actions: [...esc, { click: '[data-act="rd-tab"][data-id="handover"]' }, { wait: 1300 }],
    callouts: [{ key: 'driver', selector: '[data-act="rd-open"][data-kind="driver"]' }, { key: 'company', selector: '[data-act="rd-open"][data-kind="company"]' }] },
  { id: 'm-cashback', url: null, actions: [{ click: '[data-act="rd-tab"][data-id="cash"]' }, { wait: 1300 }],
    callouts: [{ key: 'handin', selector: '[data-act="rd-handin"]' }] },
  { id: 'm-safeers', url: null, actions: go('safeers', 2200), callouts: [{ key: 'give', selector: '[data-sf="give"]' }] },
  { id: 'm-products', url: null, actions: go('products', 2000),
    callouts: [{ key: 'find', selector: '#prodFind' }, { key: 'add', selector: '[data-view="warehouse"][data-tab="add"]' }] },
  { id: 'm-product', url: null, actions: [{ click: '[data-act="open-product"]' }, { wait_for: '.drawer' }, { wait: 900 }],
    callouts: [{ key: 'price', selector: '[data-act="pq-open"]' }, { key: 'labels', selector: '[data-act="labels-for"]' }, { key: 'more', selector: '[data-act="pr-menu"]' }] },
  { id: 'm-price', url: null, actions: [{ click: '[data-act="pq-open"]' }, { wait_for: '.modal' }, { wait: 600 }], clip: '.modal', clip_padding: 10 },
  { id: 'm-weborders', url: null, actions: [...esc, ...esc, ...go('weborders', 2000)] },
  { id: 'm-print', url: null, actions: go('print', 2000), callouts: [{ key: 'new', selector: '[data-act="pj-new"]' }] },
  { id: 'm-reviews', url: null, actions: go('reviews', 2000) },
]);

// ---------------------------------------------------------------- cashier: the till
const cashier = base([
  { id: 'c-home', url: null, actions: go('dashboard'), callouts: [{ key: 'sell', selector: '.hm-job[data-id="sell"]' }, { key: 'close', selector: '.hm-job[data-id="closeday"]' }] },
  { id: 'c-pos', url: null, actions: go('pos', 2000),
    callouts: [{ key: 'scan', selector: '#posScan' }, { key: 'cats', selector: '[data-pos="cat"]' }, { key: 'tile', selector: '.pcard:not(.dead)' },
      { key: 'cart', selector: '#cartLines' }] },
  { id: 'c-pick', url: null, actions: [{ click: '.pcard[data-id="50"]' }, { wait_for: '[data-pos="size"]' }, { wait: 600 }],
    clip: '.modal', clip_padding: 10, callouts: [{ key: 'size', selector: '[data-pos="size"][data-sku="OG-050-43"]' }] },
  { id: 'c-cust', url: null, actions: [{ click: '[data-pos="size"][data-sku="OG-050-43"]' }, { wait: 700 },
      { click: '.pcard[data-id="54"]' }, { wait_for: '[data-pos="size"]' }, { click: '[data-pos="size"][data-sku="OG-054-40"]' }, { wait: 700 },
      { click: '#posCust' }, { wait_for: '[data-pos="cust-pick"]' }, { wait: 500 }],
    callouts: [{ key: 'lines', selector: '#cartLines' }, { key: 'cust', selector: '#posCust' }, { key: 'list', selector: '[data-pos="cust-pick"]' }] },
  { id: 'c-cart', url: null, actions: [{ click: '[data-pos="cust-pick"]' }, { wait: 800 },
      { eval: "document.getElementById('cartFoot').scrollTop=0" }, { wait: 400 }],
    clip: '.pos-right', clip_padding: 0,
    callouts: [{ key: 'qty', selector: '[data-pos="inc"]' }, { key: 'remove', selector: '[data-pos="del"]' }, { key: 'cust', selector: '#custWrap' },
      { key: 'disc', selector: '#posDisc' }, { key: 'coupon', selector: '#posCoupon' }] },
  { id: 'c-pay', url: null, actions: [{ scroll_to: '[data-pos="complete"]' }, { wait: 500 }],
    clip: '.pos-right', clip_padding: 0,
    callouts: [{ key: 'total', selector: '#cartTotals' }, { key: 'place', selector: '[data-pos="wh"]' }, { key: 'pay', selector: '#payGrid' },
      { key: 'complete', selector: '[data-pos="complete"]' }] },
  { id: 'c-transfer', url: null, actions: [{ click: '#payGrid [data-pos="pay"] >> nth=1' }, { wait_for: '#posTxn' }, { wait: 500 }, { scroll_to: '#posTxn' }],
    clip: '.pos-right', clip_padding: 0,
    callouts: [{ key: 'method', selector: '#payGrid [data-pos="pay"] >> nth=1' }, { key: 'txn', selector: '#posTxn' }] },
  { id: 'c-done', url: null, actions: [{ click: '#payGrid [data-pos="pay"] >> nth=0' }, { wait: 400 }, { click: '[data-pos="complete"]' },
      { wait_for: '[data-act="new-sale"]' }, { wait: 1200 }], clip: '.modal', clip_padding: 10,
    callouts: [{ key: 'print', selector: '[data-act="print-receipt-now"]' }, { key: 'new', selector: '[data-act="new-sale"]' }] },
  { id: 'c-customers', url: null, actions: [...esc, ...go('customers', 2000)],
    callouts: [{ key: 'new', selector: '[data-act="cu-new"]' }, { key: 'search', selector: '[data-change="cust-q"]' }, { key: 'card', selector: '[data-act="cu-open"]' }] },
  { id: 'c-cust-new', url: null, actions: [{ click: '[data-act="cu-new"]' }, { wait_for: '#cuName' }, { wait: 500 }], clip: '.modal', clip_padding: 10,
    callouts: [{ key: 'name', selector: '#cuName' }, { key: 'phone', selector: '#cuPhone' }, { key: 'save', selector: '[data-act="cu-save"]' }] },
  { id: 'c-count', url: null, actions: [...esc, ...go('money', 2000), { click: '[data-cb="dc-recount"]', optional: true }, { wait: 600 }, { fill: { selector: '#dcCnt_SYP', value: '765000' } }, { fill: { selector: '#dcCnt_USD', value: '65' } }, { wait: 500 }],
    clip: '#view .card', clip_padding: 6,
    callouts: [{ key: 'syp', selector: '#dcCnt_SYP' }, { key: 'usd', selector: '#dcCnt_USD' }, { key: 'save', selector: '[data-cb="dc-count"]' }] },
  { id: 'c-count-saved', url: null, actions: [{ click: '[data-cb="dc-count"]' }, { wait: 1800 }], clip: '#view .card', clip_padding: 6,
    callouts: [{ key: 'again', selector: '[data-cb="dc-recount"]' }] },
]);

// ---------------------------------------------------------------- warehouse
const warehouse = base([
  { id: 'w-home', url: null, actions: go('dashboard') },
  { id: 'w-arrived', url: null, actions: [...go('warehouse', 2000), { click: '[data-act="wh-tab"][data-tab="arrived"]' }, { wait: 1200 }],
    callouts: [{ key: 'jobs', selector: '[data-act="wh-tab"][data-tab="arrived"]' }, { key: 'po', selector: '[data-act="rc-po"]' },
      { key: 'free', selector: '[data-act="rc-free"]' }, { key: 'new', selector: '[data-act="rc-new-product"]' }] },
  { id: 'w-move', url: null, actions: [{ click: '[data-act="wh-tab"][data-tab="move"]' }, { wait_for: '#msCode' }, { wait: 800 }], clip: '.modal', clip_padding: 10,
    callouts: [{ key: 'from', selector: '[data-change="ms-from"]' }, { key: 'to', selector: '[data-change="ms-to"]' }, { key: 'code', selector: '#msCode' },
      { key: 'go', selector: '[data-act="ms-go"]' }] },
  { id: 'w-find', url: null, actions: [...esc, { click: '[data-act="wh-tab"][data-tab="stock"]' }, { wait: 1200 }],
    callouts: [{ key: 'find', selector: '#whFind' }] },
  { id: 'w-count', url: null, actions: [{ click: '[data-act="wh-tab"][data-tab="count"]' }, { wait: 1200 }],
    callouts: [{ key: 'start', selector: '[data-st="start"]' }] },
  { id: 'w-add', url: null, actions: [{ click: '[data-act="wh-tab"][data-tab="add"]' }, { wait: 1300 }],
    callouts: [{ key: 'name', selector: '#whName' }, { key: 'type', selector: '[data-change="wh-type"]' }, { key: 'price', selector: '#whPrice' },
      { key: 'saveprint', selector: '[data-act="wh-save-print"]' }, { key: 'save', selector: '[data-act="wh-save"]' }] },
  { id: 'w-labels', url: null, actions: go('labels', 2000), callouts: [{ key: 'all', selector: '[data-act="lb-print-all"]' }] },
]);

// ---------------------------------------------------------------- safeer, on his phone
const safeer = base([
  { id: 's-runs', url: null, actions: [...go('dashboard', 2200), { scroll_to: '[data-act="dl-done"]' }, { eval: 'document.activeElement && document.activeElement.blur()' }, { wait: 600 }],
    callouts: [{ key: 'go', selector: '[data-act="dl-go"]' }, { key: 'done', selector: '[data-act="dl-done"]' }] },
], { viewport: { width: 390, height: 844 }, is_mobile: true, device_scale_factor: 3, mobile: true });

// Past the tour, a screen is shot without the sidebar: the page itself prints larger.
const KEEP_FULL = new Set(['o-home', 'c-home', 'c-pos', 'c-cust', 'w-home', 'm-home']);
for (const cfg of [owner, manager, cashier, warehouse])
  for (const sc of cfg.screens) if (!sc.clip && !KEEP_FULL.has(sc.id)) { sc.clip = '#view'; sc.clip_padding = 0; }
const out = { gate, owner, manager, cashier, warehouse, safeer };
for (const [k, v] of Object.entries(out)) writeFileSync(new URL(`./shots-${k}.json`, import.meta.url), JSON.stringify(v, null, 2));
console.log('wrote', Object.keys(out).map(k => `shots-${k}.json`).join(', '));
