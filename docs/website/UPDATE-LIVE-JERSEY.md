# Update: the live jersey (13 Oct 2026)

For the OG Sports website. **Nothing changes in the data you receive.** This is a ready-made file
that draws the print preview for you, live as the customer types.

## What it is

`docs/website/og-jersey.js`: one file, no dependencies, no build step. Copy it into the website.

- It draws the back of the shirt **exactly as OG System draws it**: the same shirt, the name on
  its curve, the sizes, outline and shadow, and **each kit's own font**. What the customer sees is
  what Yalla Wear prints.
- **Live:** every key the customer types appears on the shirt with a short "heat-press" animation.
  The shirt tilts towards the mouse on a computer, never on a phone. All movement stops for
  customers who ask their system for reduced motion.
- **The shop's rules, as they type:**
  - lower case becomes upper case, and curly apostrophes become straight;
  - anything that can't be printed (Arabic letters, emoji, other symbols) is left out, and the
    customer is told why;
  - the name is held at `print.maxLetters`;
  - the number takes digits only, Arabic-keypad digits included, 0–99.

  Messages are in English and Arabic.
- **At Add to cart,** `jersey.check()` gives the final answer with the **same codes the shop
  uses** (`print_name_and_number`, `print_bad_name`, `print_name_too_long`, `print_bad_number`),
  so an order it accepts is one the shop accepts.

Open `docs/website/og-jersey-demo.html` in a browser to try it: three styles, both languages,
phone and desktop.

## How to use it

```html
<div id="jersey"></div>
<input id="pName"> <input id="pNumber">
<p id="pMsg" aria-live="polite"></p>
<button id="addToCart" disabled>Add to cart</button>

<script src="/og-jersey.js"></script>
<script>
  // product.print comes from web_products / web_product (contract v1.6, §3b).
  // If it is null, the product is not printable: do not show the jersey.
  var jersey = OGJersey.mount(document.getElementById('jersey'), {
    print: product.print,
    lang: siteLang,                         // 'en' or 'ar'
    nameInput: document.getElementById('pName'),
    numberInput: document.getElementById('pNumber'),
    messageEl: document.getElementById('pMsg'),
    onChange: function (s) { addToCart.disabled = !s.ok; }
  });

  addToCart.onclick = function () {
    var r = jersey.check();
    if (!r.ok) return;                      // the message box already says why
    cartLine.print = { name: r.name, number: r.number, kitId: product.print.kitId };
  };
</script>
```

- **The customer picks another style** (`web_print_styles`): call `jersey.setPrint(style)`. The
  name and number stay.
- **The page language changes:** call `jersey.setLang('ar')`.
- **React or Next.js:** call `mount` in an effect on a `ref`, and `jersey.destroy()` on unmount.
  The file touches nothing outside the element it is given (plus one `<style>` tag).
- `shirtColor: '#0a3d91'` in the options paints the shirt itself. Leave it out and the shirt takes
  a neutral colour chosen against the text.
- The fonts come from the shop's public bucket. The browser loads them straight from their `url`;
  nothing to configure.

## Rules (unchanged, contract §3b)

A name AND a number, always together. Name: A–Z, space, `.` `'` `-`, at least one letter, at most
`maxLetters`. Number: 0–99. The order line is `{ sku, qty, print: { name, number, kitId } }`.
