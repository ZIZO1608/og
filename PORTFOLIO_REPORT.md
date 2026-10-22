# OG System — Portfolio Report

## 1. One-line summary

OG System is a complete retail operations system for a sneaker and streetwear shop in Aleppo, Syria. It covers the till, two warehouses, customers, money, deliveries, a website shop window and a separate portal for the shop's print partner. Cashiers, warehouse staff, delivery drivers, managers, the owner and an outside print company all use it every day, in Arabic and English.

---

## 2. Modules

| Module | What it does |
|---|---|
| **Home (by role)** | Each person signs in to 4–6 big job buttons picked for their role. The owner also gets a live dashboard of the shop's figures. |
| **Point of Sale (till)** | Fast scan-and-sell checkout, split payments in lira and dollars, discounts with a ceiling, coupons, and automatic receipt printing. |
| **Customers** | Customer profiles with a full timeline, loyalty points or stamp cards, debts and credit limits, a "wanted size" list, and duplicate merging. |
| **Coupons** | Discount codes with rules (minimum basket, dates, use limits). QR stickers and shareable images can be printed in batches for street campaigns. |
| **Products** | The catalogue: colours × sizes, priced in dollars with the lira worked out live, several photos per colour, and a switch for whether each product shows on the website. |
| **Warehouse** | Four everyday jobs: goods arrived, move stock, where is it?, and stock count. Purchase orders, an append-only movement log and the wants list are here too. |
| **Shelf map (3D)** | A walkable 3D model of the real back room with racks, bays and a box for every pair. Racks can be dragged, resized and edited from inside the room. |
| **Labels** | Barcode labels for products and shelves, printed to a thermal label printer or through the browser. |
| **Money** | Every lira and dollar by place (drawer, owner, transfer wallets, safe), closing the day, expenses, suppliers, salaries, debts, and a monthly profit-and-loss statement. |
| **Payment methods** | Lets the owner choose which transfer methods and button colours the website checkout offers, and confirms what the website really shows. |
| **Reports** | Sales, profit, inventory, payments, employees and suppliers for any date range, with Excel and PDF export. |
| **Order desk** | A five-step flow for phone and Instagram orders: bag, customer, how it travels, address, payment. |
| **Deliveries board** | Live lanes for parcels, signed handover sheets for drivers and couriers, a "cash back" screen for drivers, and returns. |
| **Safeers (delivery team)** | The delivery team's tasks and errands, with pay per delivery and the cash each driver is carrying. |
| **Reviews** | Customer ratings of deliveries. A review appears on the website only when both the customer and the shop allow it. |
| **Website orders** | Orders from the online shop wait for a person to call the customer and accept or reject. The customer is then notified on the website. |
| **Night requests** | A small "night mode" app for staff to request orders while the shop is closed. They wait until someone accepts them. |
| **Print jobs (Yalla Wear)** | Jersey name-and-number printing sent to the partner company, with stages, invoices, payments and reviews. |
| **Print kits** | Jersey lettering styles and fonts. A font can come from the internet or be built from a photo of the letters. |
| **Partner portal** | A separate, locked-down portal for the print company: job queue, invoices, earnings and reviews. It never shows the shop's customers or margins. |
| **Settings & Access** | Shop details, receipt and label printers, exchange rate, delivery prices, and permissions per person. |
| **Control panel (launcher)** | A desktop app that opens the shop, checks printers, certificates and connections, and keeps the system running. |

---

## 3. Top features

- ⭐ **Keeps selling when the internet drops.** A local backup computer takes over the till, sells on pre-reserved invoice numbers, and sends every sale to the main server once the line comes back.
- ⭐ **Walkable 3D warehouse.** The real back room is modelled to scale. Each box shows the product's photo. Racks are dragged and resized inside the room, with safety rules for aisles and ceiling height.
- ⭐ **Two-currency money engine.** Prices are set in dollars and the lira follows a live exchange-rate feed. Every sale freezes the rate it used, and every place money sits has its own balance.
- **Role-based home screens.** Big, simple buttons for staff who are not computer people, with every permission enforced on the server.
- **Full delivery office.** Five ways to ship a parcel, deposits and cash on delivery, signed handover sheets, four kinds of return, and a live tracking page for the customer with phone notifications.
- **Website integration.** The online shop reads the live catalogue. Website orders, coupons, payment methods and reviews all flow between the website and the shop system.
- **Partner portal.** A second company works inside the same system and sees only what it is allowed to see.
- **Street coupon campaigns.** Batches of single-use QR stickers. The system counts how often each sticker was found and alerts the owner the moment one is used.
- **Telegram bots.** Reminders, daily summaries and commands. The bot is built and currently switched off at the owner's request.
- **Barcode-first everywhere.** Any scan works on any screen: products, invoices, loyalty cards and coupons. It works even when the keyboard is set to Arabic.

---

## 4. User roles

| Role | What they can do |
|---|---|
| **Owner** | Everything: all money, profit, costs, staff, settings and permissions, plus the full dashboard. |
| **Developer** | The same as the owner, plus the advanced technical settings and the control panel's developer tools. |
| **Manager** | Runs the shop day to day: sales, stock, deliveries and customers. Money, cost, profit, staff and access are off by default and can be granted per person. |
| **Cashier** | Sells at the till, counts the drawer blind at night, sees and answers website orders, and attaches customers. |
| **Warehouse** | Adds products and prices, receives goods, moves and counts stock, and prints labels. |
| **Delivery (Safeer)** | Sees only their own parcels and errands, marks them delivered, and tracks the cash they carry. |
| **Partner (Yalla Wear)** | Locked into their own portal: print jobs, invoices, payments and reviews. They can never see customers, costs or the shop's money. |

Permissions can be changed per person in Settings → Access. The server enforces every rule, not just the screen.

---

## 5. Key workflows

**Making a sale**
1. The cashier scans a product. A product with several colours shows colour swatches to pick from.
2. Optionally, attach a customer, add a coupon or a small discount.
3. Choose the payment, which can be split across lira, dollars or a transfer wallet.
4. Press Complete. The receipt prints automatically, and stock and loyalty points update.

**Receiving new stock**
1. Warehouse → Goods arrived. Pick the purchase order, or "not from an order".
2. Count what arrived. The quantities still owed are filled in already.
3. Confirm where it goes. The supplier's balance moves by what actually arrived.
4. Print one barcode label per piece.

**A phone order with delivery**
1. Order desk: scan items into the bag and choose or create the customer.
2. Choose how it travels (own driver, transport office, courier, abroad or pickup) and the address.
3. Record the payment plan: full, deposit or on delivery. Save, and the slip and invoice print.
4. On the Deliveries board, put the parcel on a handover sheet, have the driver sign, and send it out. Mark it delivered and take the cash back.
5. The customer follows it on a live tracking page and gets a phone notification.

**A return**
1. Open the order and choose what came back.
2. Choose the outcome: exchange, store credit, refund, or keep the shipping fee.
3. The stock goes back on the shelf and the money settles so the order ends at zero.

**Closing the day**
1. The cashier counts lira and dollars without seeing what the system expects.
2. The owner sees the difference, confirms, and records the cash taken home.
3. The drawer's float carries over to tomorrow.

---

## 6. Automations & integrations

- **Cloud backup copy.** Every change is copied to a cloud database within seconds, plus a full check every hour.
- **Backup computer.** A standby computer keeps a fresh read-only copy every few minutes and takes over the till during an outage.
- **Automatic updates.** The server installs new versions by itself and rolls back if anything fails.
- **Comes back by itself.** After a power cut or a crash the system restarts with nobody there.
- **Exchange-rate feed.** The dollar rate updates on a timer. A sudden big jump is held for a person to approve.
- **Receipt and label printing.** Thermal receipts and barcode labels print automatically. A small print agent on the shop computer lets the cloud server reach the printers.
- **Barcodes and QR codes.** Generated for products, shelves, invoices, loyalty cards and coupons.
- **Telegram bots** (built, currently off). Order alerts, about 25 kinds of reminders (stock running out, unpaid drivers, late print jobs, morning summary) and chat commands.
- **Web push notifications** that tell customers about their order.
- **Website sync.** The website is told when the catalogue changes. It collects orders while the shop is closed, and is told when an order is accepted.
- **Exports.** Branded Excel spreadsheets and printable PDFs from every list and report.
- **Live screens.** Boards, the bell and the till update by themselves when something changes elsewhere.

---

## 7. Languages & devices

- **Arabic and English**, with true right-to-left layouts built for both languages, not a mirrored copy. WhatsApp messages are always written in both languages.
- **Works offline.** The app keeps a full offline copy on the device, and the backup computer keeps the till selling without internet. A queue holds some actions until the connection returns.
- **Phone, tablet and desktop.** Every screen was checked at six phone widths. Dialogs become bottom sheets on phones, and buttons are sized for a thumb. The app can be installed on a phone like a regular app.
- **Printing.** 80 mm thermal receipts, including Arabic, plus gift slips, A4 invoices, handover sheets, 60 × 40 mm barcode labels and shelf labels.
- **Scanning.** Works with USB barcode guns and with the phone camera.
- Dark mode, with one consistent visual style throughout.

---

## 8. Numbers

| | |
|---|---|
| Main screens (sidebar pages) | 21, plus the separate partner portal (5 screens), a customer tracking page, a night-mode app and the desktop control panel |
| Modules | about 22 |
| Report types | 6 report tabs plus a monthly profit-and-loss statement, and Excel and PDF export from every list |
| User roles | 7 |
| Permissions | about 35, set per role and per person |
| Server API endpoints | about 260 |
| Database migrations | 75 local, plus 54 cloud schema files |
| Code files | about 73 front-end scripts, 13 stylesheets and 85 server modules |
| Size | about 160,000 lines of code, written with no frameworks and no build step |
| History | about 370 commits since August 2026 |

---

## 9. Best screens to screenshot

Use demo data with invented names, never real customers.

1. **Owner's Home** (`#dashboard`). The big job buttons, with the live dashboard underneath: today's takings in lira and dollars, best sellers, where the money is, and the to-do list.
2. **Point of Sale** (`#pos`). The product grid with photos and a basket of 2–3 pairs. Show a coupon applied, a split payment and the lime Complete Sale button.
3. **3D Shelf map** (`#shelfmap`). The walkable back room with racks full of boxes, a bay selected, and the card listing its sizes and counts.
4. **Deliveries board** (`#deliveries`). The lanes view with the four live tiles (to take out, on the road, still owed, cash with drivers) and parcel cards showing their progress rail.
5. **Money** (`#money`, "Where it is"). The hero card with lira and dollar balances, the bar showing where the money sits, and the three big jobs.
6. **Arabic on a phone.** Any of the screens above at phone width in Arabic, to show the right-to-left layout. Another good option is the customer tracking page (`/i/<token>`) with its progress rail and "Notify me" card.
