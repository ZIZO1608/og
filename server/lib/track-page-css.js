/* ==========================================================================
   OG SYSTEM — the customer's page, its look                [track-page-css.js]
   --------------------------------------------------------------------------
   Inlined into every /i/<token> page by lib/receipt.js. A string, not a file
   under css/, because this page is served by the server alone and must not
   depend on the app's service worker or its cache version.

   ALWAYS DARK, THE SHOP'S OWN MARK, LIME ONLY WHERE IT MEANS SOMETHING: the
   progress along the road, the live dot, the one button, the money that is
   settled. Chosen by the owner over a page that follows the phone's theme.

   Written for the shop's customers' phones, not the latest browser: no
   :has(), no color-mix(), physical left/right with [dir=rtl] overrides where
   a logical property would need a 2021 browser to position a line.
   ========================================================================== */

export const CSS = `
:root{color-scheme:dark;--bg:#09090B;--card:#111114;--card-2:#17171B;--line:#24242A;--line-2:#2F2F37;
  --ink:#FAFAFA;--dim:#8C8C96;--mute:#5F5F69;--lime:#C6FF00;--lime-ink:#0B0B0C;
  --lime-soft:rgba(198,255,0,.1);--lime-line:rgba(198,255,0,.3);--ok:#4ADE80;--ok-soft:rgba(74,222,128,.12);
  --warn:#FBBF24;--warn-soft:rgba(251,191,36,.1);--bad:#F87171;--bad-soft:rgba(248,113,113,.12);--r:22px}
*{box-sizing:border-box}
[hidden]{display:none!important}
html{-webkit-text-size-adjust:100%;background:var(--bg)}
body{margin:0;min-height:100vh;background:var(--bg);color:var(--ink);overflow-x:hidden;
  font:15px/1.6 "Montserrat","Segoe UI","Noto Sans Arabic",Tahoma,system-ui,-apple-system,Roboto,Arial,sans-serif;
  -webkit-font-smoothing:antialiased}
/* Arabic faces first on an Arabic page: naming a Latin face first makes the
   browser fall back glyph by glyph. The brand word and the digits keep theirs. */
html[dir=rtl] body{font-family:"Segoe UI","Noto Sans Arabic","Droid Arabic Kufi",Tahoma,system-ui,-apple-system,Roboto,Arial,sans-serif}
.lat{font-family:"Montserrat","Segoe UI",Tahoma,Arial,sans-serif}
.mono{font-family:"Montserrat",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
[dir=ltr]{unicode-bidi:isolate}
svg{display:block}

/* ---- the atmosphere: a lime bloom over a faint grid, fading down the page */
.glow{position:fixed;inset:0;pointer-events:none;z-index:0;
  background:radial-gradient(60% 42% at 50% -6%,rgba(198,255,0,.14),transparent 70%),
             radial-gradient(38% 30% at 100% 0,rgba(198,255,0,.05),transparent 70%)}
.glow::after{content:"";position:absolute;inset:0;
  background-image:linear-gradient(rgba(255,255,255,.028) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.028) 1px,transparent 1px);
  background-size:44px 44px;
  -webkit-mask-image:radial-gradient(70% 50% at 50% 0,#000,transparent 78%);mask-image:radial-gradient(70% 50% at 50% 0,#000,transparent 78%)}

/* ---- the bar */
.top{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:10px 16px;padding-top:calc(10px + env(safe-area-inset-top));
  background:rgba(9,9,11,.74);-webkit-backdrop-filter:saturate(1.4) blur(14px);backdrop-filter:saturate(1.4) blur(14px);
  border-bottom:1px solid rgba(255,255,255,.06)}
.brand{display:flex;align-items:center;gap:11px;min-width:0}
.logo{position:relative;flex:none;width:42px;height:42px;border-radius:13px;overflow:hidden;background:#000;
  display:flex;align-items:center;justify-content:center;
  box-shadow:0 0 0 1px rgba(255,255,255,.12),0 8px 22px -8px rgba(198,255,0,.45)}
.logo b{font-weight:800;font-size:14px;letter-spacing:.04em;color:#fff}
.logo img{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover}
.bn{display:flex;flex-direction:column;min-width:0;line-height:1.25}
.bn strong{font-weight:800;letter-spacing:.14em;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bn small{color:var(--dim);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.top-r{display:flex;align-items:center;gap:8px;flex:none}
.live{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 11px;border-radius:999px;
  border:1px solid var(--line);color:var(--dim);font-size:10.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;white-space:nowrap}
.live i{width:7px;height:7px;border-radius:50%;background:var(--mute);flex:none}
.live[data-state=on]{color:var(--lime);border-color:var(--lime-line);background:var(--lime-soft)}
.live[data-state=on] i{background:var(--lime);animation:beat 1.8s infinite}
.live[data-state=wait] i{background:var(--warn)}
.live[data-state=poll] i{background:var(--ok)}
.live[data-state=offline] i{background:var(--bad)}
.lang{height:30px;display:inline-flex;align-items:center;padding:0 12px;border-radius:999px;border:1px solid var(--line);
  color:var(--ink);text-decoration:none;font-size:12px;font-weight:700;background:rgba(255,255,255,.02)}
@keyframes beat{0%{box-shadow:0 0 0 0 rgba(198,255,0,.55)}70%{box-shadow:0 0 0 8px rgba(198,255,0,0)}100%{box-shadow:0 0 0 0 rgba(198,255,0,0)}}

/* ---- the grid. A laptop has two columns: the hero with the journey under it,
   and a SIDE column of money, notify, parcel and exchange stacked tight. Laid
   out as grid rows instead, the hero's row took the height of money + notify
   and left a 130px hole above the journey. On a phone .side is
   display:contents and "order" sets the reading order: hero → money → notify
   → journey → parcel. The live refresh swaps cards by id and never sees .side. */
.wrap{position:relative;z-index:1;max-width:1080px;margin:0 auto;display:grid;gap:14px;grid-template-columns:minmax(0,1fr);
  padding:16px 14px;padding-bottom:calc(44px + env(safe-area-inset-bottom))}
.side{display:contents}
.hero{order:1}.review{order:2}.money{order:3}.notify{order:4}.time{order:5}.items{order:6}.extra{order:7}.foot{order:8}
@media (min-width:900px){
  .wrap{padding:28px 24px 64px;gap:18px;grid-template-columns:minmax(0,1.28fr) minmax(0,1fr);align-items:start;
    grid-template-areas:"hero side" "time side" "foot foot";grid-template-rows:auto 1fr auto}
  .wrap.is-receipt{grid-template-areas:"hero side" ". side" "foot foot"}
  .side{display:flex;flex-direction:column;gap:18px;grid-area:side;min-width:0}
  .hero{grid-area:hero}.time{grid-area:time}.foot{grid-area:foot}
}

/* ---- a card */
.card{position:relative;min-width:0;border:1px solid var(--line);border-radius:var(--r);padding:20px;
  background:linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,0) 42%),var(--card);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.04),0 18px 40px -26px rgba(0,0,0,.9);
  animation:rise .5s cubic-bezier(.2,.7,.3,1) backwards}
.money{animation-delay:.05s}.notify{animation-delay:.1s}.time{animation-delay:.13s}.items{animation-delay:.17s}.extra{animation-delay:.21s}
@keyframes rise{from{opacity:0;transform:translateY(12px)}}
.card-h{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 16px}
.card-h h2{margin:0;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--dim)}
.count{min-width:26px;height:22px;padding:0 8px;border-radius:999px;background:var(--card-2);border:1px solid var(--line);
  font-size:11.5px;font-weight:700;color:var(--dim);display:inline-flex;align-items:center;justify-content:center}

/* ---- the hero: where it is, in one sentence, and how far along */
.hero{overflow:hidden;padding:20px 20px 18px}
.hero::before{content:"";position:absolute;right:-90px;top:-120px;width:320px;height:320px;pointer-events:none;
  background:radial-gradient(closest-side,rgba(198,255,0,.15),transparent)}
html[dir=rtl] .hero::before{right:auto;left:-90px}
.hero-mark{position:absolute;right:-30px;bottom:-52px;width:160px;height:160px;opacity:.05;mix-blend-mode:screen;pointer-events:none;border-radius:36px}
html[dir=rtl] .hero-mark{right:auto;left:-30px}
.hero-top{position:relative;display:flex;align-items:center;justify-content:space-between;gap:8px 10px;flex-wrap:wrap}
.chip{display:inline-flex;align-items:center;gap:8px;height:30px;padding:0 12px;border-radius:999px;background:var(--card-2);
  border:1px solid var(--line);font-size:12px;color:var(--dim);white-space:nowrap}
.chip b{color:var(--ink);font-size:12.5px;letter-spacing:.04em}
.hero-date{font-size:12px;color:var(--dim)}
.eyebrow{position:relative;margin:22px 0 6px;font-size:12.5px;color:var(--dim);font-weight:600}
.headline{position:relative;margin:0;font-size:clamp(27px,7.4vw,40px);line-height:1.1;font-weight:800;letter-spacing:-.02em;overflow-wrap:anywhere}
.hero.is-done .headline{color:var(--lime);text-shadow:0 0 28px rgba(198,255,0,.28)}
.hero.is-bad .headline,.hero.is-void .headline{color:var(--bad)}
.hero .big{position:relative;margin:12px 0 0}
.hero-foot{position:relative;display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between;
  margin-top:18px;padding-top:14px;border-top:1px dashed var(--line);font-size:12px;color:var(--dim)}
.upd,.trk{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap}
.upd svg{width:14px;height:14px}
.upd .rel:not(:empty)+.abs{display:none}
.trk b{color:var(--ink);letter-spacing:.05em}
.stamp{position:absolute;top:62px;right:18px;z-index:2;padding:6px 14px;border:2.5px solid var(--bad);color:var(--bad);border-radius:8px;
  font-weight:800;letter-spacing:.16em;font-size:13px;transform:rotate(-8deg);background:rgba(9,9,11,.7)}
html[dir=rtl] .stamp{right:auto;left:18px}

/* ---- the rail: four stops, a lime line filling towards the one it is at */
.rail{position:relative;margin:26px 0 2px}
.rail-track{position:absolute;top:17px;left:12.5%;right:12.5%;height:3px;border-radius:3px;background:var(--line-2);overflow:hidden}
.rail-fill{position:absolute;top:0;bottom:0;left:0;border-radius:3px;width:calc(var(--p,0) * 100%);
  background:linear-gradient(90deg,#8FC400,var(--lime));box-shadow:0 0 14px rgba(198,255,0,.55);
  transform-origin:left center;animation:grow 1s .25s cubic-bezier(.2,.7,.2,1) backwards}
html[dir=rtl] .rail-fill{left:auto;right:0;transform-origin:right center;background:linear-gradient(270deg,#8FC400,var(--lime))}
@keyframes grow{from{transform:scaleX(0)}}
.rail ol{position:relative;display:flex;list-style:none;margin:0;padding:0}
.st{flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center}
.st b{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  background:var(--card);border:2px solid var(--line-2);color:var(--mute)}
.st svg{width:16px;height:16px}
.st span{font-size:11.5px;font-weight:600;color:var(--mute);line-height:1.25;max-width:100%;overflow-wrap:anywhere}
.st.on b{background:var(--lime);border-color:var(--lime);color:var(--lime-ink)}
.st.on span,.st.now span{color:var(--ink)}
.st.now b{border-color:var(--lime);color:var(--lime);box-shadow:0 0 0 5px var(--lime-soft);animation:ring 2.2s infinite}
@keyframes ring{50%{box-shadow:0 0 0 9px rgba(198,255,0,.03)}}
.rail.back .st.on b{background:var(--bad);border-color:var(--bad);color:#1A0B0B}
.rail.back .st.now b{border-color:var(--bad);color:var(--bad);box-shadow:0 0 0 5px var(--bad-soft);animation:none}
.rail.back .rail-fill{background:var(--bad);box-shadow:none}
.rail.off .rail-fill{display:none}

/* ---- money */
.label{margin:0;font-size:12px;font-weight:800;color:var(--dim);text-transform:uppercase;letter-spacing:.1em}
.big{margin:8px 0 14px;font-size:clamp(34px,9vw,46px);font-weight:800;line-height:1.05;letter-spacing:-.03em;
  display:flex;align-items:center;gap:10px;flex-wrap:wrap}
/* .big is always dir=ltr (an amount), so the gap is always on the left of the
   code — an [dir=rtl] override here put it on the far side and glued "2,750SYP". */
.big small{font-size:.4em;font-weight:700;color:var(--dim);letter-spacing:0;margin-left:6px}
.big svg{width:.8em;height:.8em;stroke-width:3}
.money.clear .big{color:var(--lime)}
.bar{height:8px;border-radius:8px;background:var(--line);overflow:hidden}
.bar i{display:block;height:100%;border-radius:8px;background:var(--lime);transform-origin:left center;animation:grow .9s .3s backwards}
html[dir=rtl] .bar i{margin-right:0;margin-left:auto;transform-origin:right center}
.money .sub{margin:10px 0 0;font-size:12.5px;color:var(--dim)}
.note{margin:12px 0 0;padding:10px 12px;border-radius:12px;background:var(--warn-soft);color:var(--warn);font-size:12.5px;font-weight:600;line-height:1.5}

/* ---- notify me */
.notify{display:flex;flex-direction:column;gap:14px}
.n-head{display:flex;gap:12px;align-items:flex-start}
.n-ico{flex:none;width:42px;height:42px;border-radius:13px;display:flex;align-items:center;justify-content:center;
  background:var(--lime-soft);color:var(--lime);border:1px solid var(--lime-line)}
.n-ico svg{width:19px;height:19px}
.notify[data-state=blocked] .n-ico,.notify[data-state=nosup] .n-ico,.notify[data-state=old] .n-ico{background:var(--card-2);color:var(--dim);border-color:var(--line)}
.notify[data-state=on] .n-ico svg{animation:swing .9s ease 1;transform-origin:50% 15%}
@keyframes swing{20%{transform:rotate(15deg)}45%{transform:rotate(-12deg)}70%{transform:rotate(6deg)}}
.n-t{margin:0;font-size:15px;font-weight:800;line-height:1.35}
.n-s{margin:4px 0 0;font-size:12.5px;color:var(--dim);line-height:1.55}
.btn{-webkit-appearance:none;appearance:none;border:0;cursor:pointer;width:100%;min-height:50px;padding:0 18px;border-radius:15px;
  font:inherit;font-weight:800;font-size:15px;display:inline-flex;align-items:center;justify-content:center;gap:9px;-webkit-tap-highlight-color:transparent}
.btn svg{width:18px;height:18px}
.btn-p{background:var(--lime);color:var(--lime-ink);box-shadow:0 12px 32px -14px rgba(198,255,0,.75)}
.btn-p:active{transform:translateY(1px);box-shadow:0 6px 18px -10px rgba(198,255,0,.7)}
.btn-g{background:transparent;color:var(--dim);border:1px solid var(--line);min-height:42px;font-weight:700;font-size:13px}
.btn[disabled]{opacity:.65;cursor:default}
.spin{width:16px;height:16px;border-radius:50%;border:2px solid rgba(11,11,12,.25);border-top-color:var(--lime-ink);animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

/* ---- the Home Screen guide. An iPhone lets a web page push only once it
   lives on the Home Screen, so the card SHOWS what that buys — a notification
   dropping in from the top of a phone — then the three taps, and a sheet that
   walks them one at a time with the phone drawn at each step. Drawn in CSS:
   no screenshot of Apple's interface, which changes every September. */
.g-demo{position:relative;height:150px;border-radius:18px;overflow:hidden;border:1px solid var(--line);
  background:radial-gradient(90% 80% at 50% 0,rgba(198,255,0,.16),transparent 65%),linear-gradient(180deg,#15170F,#0B0B0D)}
.g-ph{position:absolute;left:50%;top:16px;width:214px;height:200px;margin-left:-107px;border-radius:36px 36px 0 0;
  border:5px solid #2C2C33;border-bottom:0;background:linear-gradient(170deg,#262D12 0%,#141612 55%,#0E0E10 100%);
  box-shadow:0 0 0 1px rgba(255,255,255,.06),0 -10px 40px -10px rgba(198,255,0,.25)}
.g-isl{position:absolute;top:8px;left:50%;width:62px;height:18px;margin-left:-31px;border-radius:12px;background:#000;z-index:2}
.g-clock{position:absolute;top:84px;left:0;right:0;text-align:center;font-family:"Montserrat",system-ui,sans-serif;font-weight:300;
  font-size:36px;letter-spacing:-.02em;color:rgba(255,255,255,.85);line-height:1}
.g-note{position:absolute;left:8px;right:8px;top:34px;z-index:1;display:flex;align-items:center;gap:8px;padding:8px 9px;border-radius:15px;
  background:rgba(48,48,54,.88);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);box-shadow:0 10px 24px -10px rgba(0,0,0,.85);
  animation:gdrop 4.6s cubic-bezier(.2,1.2,.3,1) infinite}
.g-note img{flex:none;width:26px;height:26px;border-radius:7px;background:#000}
.g-note div{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.3}
.g-note b{font-size:10px;font-weight:800;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.g-note span{font-size:10px;color:#D4D4D8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.g-note em{flex:none;align-self:flex-start;font-style:normal;font-size:8.5px;color:rgba(255,255,255,.5)}
@keyframes gdrop{0%,10%{opacity:0;transform:translateY(-160%) scale(.96)}22%,80%{opacity:1;transform:translateY(0) scale(1)}92%,100%{opacity:0;transform:translateY(-160%) scale(.96)}}
.g-steps{list-style:none;margin:0;padding:0}
.g-steps li{display:flex;align-items:center;gap:12px;padding:11px 0;border-top:1px solid var(--line)}
.g-steps li:first-child{border-top:0;padding-top:0}
.g-n{flex:none;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;
  background:var(--lime-soft);color:var(--lime);border:1px solid var(--lime-line)}
.g-steps div{flex:1;min-width:0}
.g-steps b{display:block;font-size:14px;font-weight:700;line-height:1.35}
.g-steps small{display:block;margin-top:2px;font-size:12px;color:var(--dim);line-height:1.5}
.g-k{flex:none;width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;
  background:var(--card-2);border:1px solid var(--line);color:var(--ink)}
.g-k svg{width:17px;height:17px}
.g-tip{margin:0;padding:10px 12px;border-radius:12px;background:var(--card-2);border:1px solid var(--line);
  display:flex;gap:9px;align-items:flex-start;font-size:12px;color:var(--dim);line-height:1.5}
.g-tip svg{flex:none;width:15px;height:15px;margin-top:2px;color:var(--lime)}
.notify[data-state=ready] .btn-p{animation:nudge 2.2s ease-in-out infinite}
@keyframes nudge{0%,100%{box-shadow:0 12px 32px -14px rgba(198,255,0,.75),0 0 0 0 rgba(198,255,0,.45)}50%{box-shadow:0 12px 32px -14px rgba(198,255,0,.75),0 0 0 10px rgba(198,255,0,0)}}

/* touch-action: a sideways swipe turns the sheet's page; left to the browser
   it was taken as Back, and the whole order page went with it. */
.sheet{position:fixed;left:0;top:0;right:0;bottom:0;z-index:50;display:flex;align-items:flex-end;justify-content:center;
  touch-action:pan-y;overscroll-behavior:contain;
  background:rgba(0,0,0,.72);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);animation:fade .25s ease}
.sh-box{position:relative;width:100%;max-width:460px;max-height:100%;overflow:auto;-webkit-overflow-scrolling:touch;
  padding:12px 18px calc(18px + env(safe-area-inset-bottom));background:var(--card);border:1px solid var(--line-2);border-bottom:0;
  border-radius:26px 26px 0 0;text-align:center;box-shadow:0 -30px 60px -20px rgba(0,0,0,.9);animation:up .38s cubic-bezier(.2,1,.3,1)}
@media (min-width:600px){.sheet{align-items:center;padding:20px}.sh-box{border-bottom:1px solid var(--line-2);border-radius:26px;padding-top:18px}}
.sh-grab{display:block;width:38px;height:5px;border-radius:5px;background:var(--line-2);margin:0 auto 12px}
.sh-x{position:absolute;top:12px;right:12px;z-index:2;width:34px;height:34px;padding:0;border-radius:50%;border:1px solid var(--line);
  background:var(--card-2);color:var(--dim);display:flex;align-items:center;justify-content:center;cursor:pointer}
html[dir=rtl] .sh-x{right:auto;left:12px}
.sh-x svg{width:15px;height:15px}
.sh-stage{position:relative;height:292px;margin:0 0 14px;border-radius:20px;overflow:hidden;border:1px solid var(--line);
  background:radial-gradient(80% 60% at 50% 0,rgba(198,255,0,.14),transparent 70%),var(--card-2);animation:fade .35s ease}
.sh-k{margin:0;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--lime)}
.sh-h{margin:4px 0 0;font-size:19px;font-weight:800;line-height:1.3}
.sh-p{margin:6px auto 0;max-width:36ch;font-size:13.5px;color:var(--dim);line-height:1.55}
.sh-here{display:inline-flex;align-items:center;gap:6px;margin:10px 0 0;padding:6px 12px;border-radius:999px;
  background:var(--lime-soft);border:1px solid var(--lime-line);color:var(--lime);font-size:12px;font-weight:700}
.sh-here svg{width:14px;height:14px;animation:bob 1.2s ease-in-out infinite}
.sh-dots{display:flex;justify-content:center;gap:6px;margin:16px 0 14px}
.sh-dots i{display:block;width:7px;height:7px;border-radius:7px;background:var(--line-2);transition:width .3s,background .3s}
.sh-dots i.on{width:22px;background:var(--lime)}
.sh-nav{display:flex;gap:10px}
.sh-nav .btn{flex:1;width:auto}
@keyframes fade{from{opacity:0}}
@keyframes up{from{opacity:0;transform:translateY(40px)}}
@keyframes bob{50%{transform:translateY(3px)}}
/* the phone inside the sheet */
.m-ph{position:absolute;left:50%;top:18px;width:172px;height:262px;margin-left:-86px;border-radius:30px;border:5px solid #2C2C33;
  background:#0E0E10;overflow:hidden;box-shadow:0 20px 50px -20px rgba(0,0,0,.9),0 0 0 1px rgba(255,255,255,.06)}
.m-isl{position:absolute;top:7px;left:50%;width:50px;height:14px;margin-left:-25px;border-radius:10px;background:#000;z-index:3}
.m-page{position:absolute;left:10px;right:10px;top:32px}
.m-page i{display:block;height:9px;margin-bottom:7px;border-radius:5px;background:#1F1F25}
.m-page i.l{height:46px;border-radius:10px;background:linear-gradient(135deg,rgba(198,255,0,.35),rgba(198,255,0,.08))}
.m-page i.s{width:60%}
.m-bar{position:absolute;left:0;right:0;bottom:0;height:70px;padding:7px 10px 0;background:rgba(30,30,36,.96);border-top:1px solid #2A2A30}
.m-url{height:21px;border-radius:8px;background:#34343B;display:flex;align-items:center;justify-content:center;
  font-family:"Montserrat",system-ui,sans-serif;font-size:8px;color:#A1A1AA;white-space:nowrap;overflow:hidden}
.m-tools{display:flex;justify-content:space-around;align-items:center;margin-top:7px;color:#8E8E96}
.m-tools span{position:relative;width:18px;height:18px;display:flex;align-items:center;justify-content:center}
.m-tools span i{display:block;width:11px;height:11px;border-radius:3px;border:1.5px solid #5F5F67}
.m-tools svg{width:15px;height:15px}
.m-tools .hot{color:var(--lime)}
.m-tools .hot::after{content:"";position:absolute;left:-8px;top:-8px;right:-8px;bottom:-8px;border-radius:50%;border:2px solid var(--lime);animation:tap 1.6s ease-out infinite}
@keyframes tap{0%{transform:scale(.55);opacity:1}100%{transform:scale(1.45);opacity:0}}
.m-dim{position:absolute;left:0;top:0;right:0;bottom:0;background:rgba(0,0,0,.5)}
.m-sheet{position:absolute;left:0;right:0;bottom:0;padding:10px 8px 14px;background:#1C1C21;border-radius:16px 16px 0 0;animation:up .5s .15s cubic-bezier(.2,1,.3,1) backwards}
.m-apps{display:flex;gap:7px;justify-content:center;margin-bottom:9px}
.m-apps i{display:block;width:24px;height:24px;border-radius:7px;background:#2C2C33}
.m-row{display:flex;align-items:center;justify-content:space-between;gap:6px;height:28px;padding:0 9px;margin-top:5px;border-radius:8px;
  background:#26262C;color:#D4D4D8;font-size:9.5px;font-weight:700;white-space:nowrap}
.m-row i{display:block;height:6px;width:55%;border-radius:4px;background:#3A3A42}
.m-row svg{flex:none;width:13px;height:13px;color:#8E8E96}
.m-row.hot{background:rgba(198,255,0,.14);color:#fff;box-shadow:0 0 0 1.5px var(--lime);animation:hot 1.6s ease-in-out infinite}
.m-row.hot svg{color:var(--lime)}
@keyframes hot{50%{box-shadow:0 0 0 4px rgba(198,255,0,.25)}}
.m-home{position:absolute;left:0;top:0;right:0;bottom:0;padding:92px 12px 0;background:linear-gradient(165deg,#28301A,#121314 60%)}
.m-grid{display:flex;flex-wrap:wrap;gap:14px 12px;justify-content:center}
.m-grid i,.m-app{display:block;width:28px;height:28px;border-radius:8px;background:rgba(255,255,255,.1)}
.m-app{position:relative;background:#000;box-shadow:0 0 0 1.5px var(--lime),0 0 18px rgba(198,255,0,.45);animation:pop .6s .3s cubic-bezier(.2,.9,.3,1.4) backwards}
.m-app img{display:block;width:100%;height:100%;border-radius:8px}
.m-ph .g-note{top:30px;animation-delay:.9s}
.m-ph .g-note span{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}

/* ---- the journey, newest first */
.tl{list-style:none;margin:0;padding:0}
.tl-r{position:relative;display:flex;gap:14px;padding:0 0 18px}
.tl-r:last-child{padding-bottom:0}
.tl-r:not(:last-child)::before{content:"";position:absolute;top:40px;bottom:4px;left:17px;width:2px;border-radius:2px;background:var(--line)}
html[dir=rtl] .tl-r:not(:last-child)::before{left:auto;right:17px}
.tl-i{flex:none;width:36px;height:36px;border-radius:12px;display:flex;align-items:center;justify-content:center;
  background:var(--card-2);border:1px solid var(--line);color:var(--dim)}
.tl-i svg{width:16px;height:16px}
.tl-b{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;padding-top:6px}
.tl-b b{font-size:14px;font-weight:700;line-height:1.35;overflow-wrap:anywhere}
.when{font-size:12px;color:var(--dim)}
.when .rel:not(:empty)::after{content:" · "}
.tone-ok .tl-i{color:var(--ok)}.tone-warn .tl-i{color:var(--warn)}.tone-bad .tl-i{color:var(--bad)}.tone-go .tl-i,.tone-done .tl-i{color:var(--lime)}
.is-latest .tl-i{background:var(--lime);border-color:var(--lime);color:var(--lime-ink);box-shadow:0 0 0 5px var(--lime-soft)}
.is-latest.tone-bad .tl-i{background:var(--bad);border-color:var(--bad);color:#1A0B0B;box-shadow:0 0 0 5px var(--bad-soft)}
.is-latest.tone-warn .tl-i{background:var(--warn);border-color:var(--warn);color:#1A1405;box-shadow:0 0 0 5px var(--warn-soft)}
.latest{flex:none;align-self:flex-start;margin-top:7px;font-style:normal;font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;
  color:var(--lime);padding:3px 8px;border-radius:999px;background:var(--lime-soft);border:1px solid var(--lime-line);white-space:nowrap}
.tl-r.is-new .tl-i{animation:pop .7s cubic-bezier(.2,.9,.3,1.4)}
.tl-r.is-new .tl-b b{animation:glint 2s ease}
@keyframes pop{0%{transform:scale(.4)}100%{transform:scale(1)}}
@keyframes glint{0%,35%{color:var(--lime)}}

/* ---- what is in it */
.its{list-style:none;margin:0;padding:0}
.it{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--line)}
.it:first-child{padding-top:0}
.it-sq{flex:none;width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;
  font-weight:800;font-size:13px;color:#fff;background:hsl(var(--h,210),34%,32%);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}
.it-n{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.it-n b{font-size:14px;font-weight:700;line-height:1.3;overflow-wrap:anywhere}
.it-n span{font-size:12px;color:var(--dim)}
.sz{display:inline-block;font-style:normal;padding:0 7px;border-radius:6px;background:var(--card-2);border:1px solid var(--line);
  color:var(--ink);font-size:11px;font-weight:700;margin-right:6px}
html[dir=rtl] .sz{margin-right:0;margin-left:6px}
.it-m{white-space:nowrap;font-weight:700;font-size:14px}
.tots{margin-top:14px;display:flex;flex-direction:column;gap:6px}
.tr{display:flex;justify-content:space-between;gap:12px;font-size:13px;color:var(--dim)}
.tr.grand{margin-top:6px;padding-top:12px;border-top:1px dashed var(--line);color:var(--ink);font-size:14px;font-weight:800;align-items:baseline}
.tr.grand .mono{font-size:22px}
.tr.grand small{font-size:12px;color:var(--dim);font-weight:700}
.fx{text-align:right;font-size:11.5px;color:var(--mute)}
html[dir=rtl] .fx{text-align:left}

/* ---- the exchange window, and the shop's own links */
.pill{display:flex;align-items:flex-start;gap:12px;padding:14px;border-radius:16px;border:1px solid var(--line);background:var(--card-2)}
.p-i{flex:none;width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center}
.p-i svg{width:16px;height:16px}
.pill.ok .p-i{background:var(--ok-soft);color:var(--ok)}
.pill.done .p-i{background:var(--card);color:var(--dim)}
.pill.bad .p-i{background:var(--bad-soft);color:var(--bad)}
.pill b{display:block;font-size:14px;line-height:1.35}
.pill span{display:block;font-size:12.5px;color:var(--dim);line-height:1.5;margin-top:2px}
.links{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.lk{flex:1 1 120px;display:flex;align-items:center;justify-content:center;gap:8px;min-height:46px;padding:0 12px;border-radius:14px;
  border:1px solid var(--line);background:var(--card-2);color:var(--ink);text-decoration:none;font-size:13px;font-weight:700}
.lk svg{width:17px;height:17px;color:var(--dim)}

.foot{text-align:center;color:var(--mute);font-size:12px;line-height:1.7;padding:6px 8px 0}
.foot p{margin:0}
.foot strong{color:var(--dim)}

/* ---- the banner that says something moved: dropped in from the top, the
   way a phone's own notification arrives, with a chime (the page's script)
   while the page is open. Tap it to jump to the journey; it lifts away. */
.banner{position:fixed;left:50%;top:calc(10px + env(safe-area-inset-top));z-index:40;transform:translateX(-50%);
  width:440px;max-width:calc(100vw - 20px);display:flex;align-items:center;gap:12px;padding:12px 14px 16px;border-radius:22px;
  background:rgba(26,26,31,.9);border:1px solid rgba(255,255,255,.1);cursor:pointer;
  box-shadow:0 24px 54px -18px rgba(0,0,0,.95),0 0 0 1px rgba(198,255,0,.07),0 0 32px -8px rgba(198,255,0,.18);
  -webkit-backdrop-filter:saturate(1.6) blur(18px);backdrop-filter:saturate(1.6) blur(18px);
  animation:drop .55s cubic-bezier(.2,1.25,.3,1)}
.banner.is-out{animation:lift .35s ease forwards}
.banner::after{content:"";position:absolute;left:50%;bottom:6px;width:34px;height:4px;border-radius:4px;background:rgba(255,255,255,.2);transform:translateX(-50%)}
.b-logo{flex:none;width:40px;height:40px;border-radius:11px;overflow:hidden;background:#000;box-shadow:0 0 0 1px rgba(255,255,255,.12)}
.b-logo img{width:100%;height:100%;display:block}
.b-txt{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.4}
.b-txt b{font-size:12.5px;font-weight:800;color:var(--ink)}
.b-txt span{font-size:13.5px;color:#D4D4D8;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.b-now{flex:none;align-self:flex-start;font-style:normal;font-size:11px;color:var(--dim);white-space:nowrap}
@keyframes drop{from{opacity:0;transform:translate(-50%,-130%)}}
@keyframes lift{to{opacity:0;transform:translate(-50%,-130%)}}
.snd{width:30px;height:30px;padding:0;border-radius:999px;border:1px solid var(--line);background:rgba(255,255,255,.02);
  color:var(--ink);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;-webkit-tap-highlight-color:transparent}
.snd svg{width:15px;height:15px}
.snd[aria-pressed=false]{color:var(--mute)}

/* ---- the review: big stars, the tags, the words, the permission, send */
.review{border-color:var(--lime-line);
  background:radial-gradient(120% 80% at 100% 0,rgba(198,255,0,.09),transparent 60%),linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,0) 42%),var(--card)}
.rv-title{margin:0;font-size:21px;font-weight:800;line-height:1.3}
.rv-form{display:flex;flex-direction:column;gap:12px;margin-top:16px}
.rv-stars{display:flex;gap:4px;justify-content:center;direction:ltr}
.rv-star{-webkit-appearance:none;appearance:none;border:0;background:none;padding:4px;cursor:pointer;color:var(--line-2);
  -webkit-tap-highlight-color:transparent;transition:transform .15s,color .15s}
.rv-star svg{width:42px;height:42px;fill:currentColor;stroke:currentColor;stroke-width:1}
.rv-star.on{color:var(--lime);filter:drop-shadow(0 0 10px rgba(198,255,0,.45))}
.rv-star:active{transform:scale(.86)}
.rv-star.pop{animation:starpop .45s cubic-bezier(.2,1.6,.3,1) backwards}
.rv-star.pop:nth-child(2){animation-delay:.04s}.rv-star.pop:nth-child(3){animation-delay:.08s}
.rv-star.pop:nth-child(4){animation-delay:.12s}.rv-star.pop:nth-child(5){animation-delay:.16s}
@keyframes starpop{0%{transform:scale(.55)}100%{transform:scale(1)}}
.rv-stars.is-static{justify-content:flex-start}
.rv-stars.is-static .rv-star{padding:0 2px;cursor:default}
.rv-stars.is-static .rv-star svg{width:24px;height:24px}
.rv-word{margin:-4px 0 0;text-align:center;font-size:13.5px;font-weight:800;color:var(--dim);min-height:22px}
.rv-form:not([data-rating="0"]) .rv-word{color:var(--lime)}
.rv-h{margin:4px 0 0;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}
.rv-tags{display:flex;flex-wrap:wrap;gap:8px}
.rv-tag{-webkit-appearance:none;appearance:none;font:inherit;font-size:13px;font-weight:700;padding:8px 13px;border-radius:999px;
  border:1px solid var(--line);background:var(--card-2);color:var(--ink);cursor:pointer;-webkit-tap-highlight-color:transparent}
.rv-tag.on{border-color:var(--lime-line);background:var(--lime-soft);color:var(--lime)}
.rv-tags.is-static .rv-tag{cursor:default;padding:5px 11px;font-size:12px}
.rv-text{position:relative}
.rv-text textarea{display:block;width:100%;min-height:96px;resize:vertical;padding:12px 14px 24px;border-radius:14px;border:1px solid var(--line);
  background:var(--card-2);color:var(--ink);font:inherit;font-size:15px;line-height:1.55}
.rv-text textarea:focus{outline:none;border-color:var(--lime-line);box-shadow:0 0 0 3px var(--lime-soft)}
.rv-count{position:absolute;right:12px;bottom:8px;font-size:10.5px;color:var(--mute)}
html[dir=rtl] .rv-count{right:auto;left:12px}
.rv-allow{display:flex;gap:11px;align-items:flex-start;padding:12px;border-radius:14px;border:1px solid var(--line);background:var(--card-2);cursor:pointer}
.rv-allow input{flex:none;width:20px;height:20px;margin:1px 0 0;accent-color:#C6FF00}
.rv-allow span{display:flex;flex-direction:column;gap:2px}
.rv-allow b{font-size:13.5px;line-height:1.4}
.rv-allow small{font-size:12px;color:var(--dim)}
.rv-done-h{display:flex;gap:12px;align-items:flex-start}
.rv-badge{flex:none;width:42px;height:42px;border-radius:13px;display:flex;align-items:center;justify-content:center;
  background:var(--lime);color:var(--lime-ink);box-shadow:0 8px 24px -8px rgba(198,255,0,.7)}
.rv-badge svg{width:20px;height:20px;stroke-width:3}
.review.is-sent .rv-badge{animation:pop .7s cubic-bezier(.2,.9,.3,1.4)}
.review.is-sent .rv-star.on{animation:starpop .5s cubic-bezier(.2,1.6,.3,1) backwards}
.rv-shown{display:flex;flex-direction:column;gap:10px;margin-top:14px}
.rv-quote{margin:0;padding:10px 14px;border-radius:12px;background:var(--card-2);border-left:3px solid var(--lime);
  font-size:14px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}
html[dir=rtl] .rv-quote{border-left:0;border-right:3px solid var(--lime)}
.rv-web{margin:0;display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--ok)}
.rv-web svg{width:14px;height:14px}
html[dir=rtl] .rv-h{letter-spacing:0}

/* Tracked capitals pull joined Arabic letters apart. */
html[dir=rtl] .live,html[dir=rtl] .card-h h2,html[dir=rtl] .label,html[dir=rtl] .latest,html[dir=rtl] .bn strong:not(.lat),
html[dir=rtl] .headline,html[dir=rtl] .stamp{letter-spacing:0}
html[dir=rtl] .headline{line-height:1.35}

@media (max-width:380px){.card{padding:16px}.st span{font-size:10.5px}.st b{width:32px;height:32px}.rail-track{top:15px}.bn small{display:none}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
`;
