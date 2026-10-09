<p align="center">
  <img src="icons/icon128.png" width="80" alt="">
</p>

<h1 align="center">CART SAVER</h1>

<p align="center">
  <b>Lost your Cardmarket cart? One click and it is back.</b><br>
  A Chrome extension for <a href="https://www.cardmarket.com">Cardmarket</a>.
</p>

<p align="center">
  <img src="docs/screenshots/popup-cart.png" width="380" alt="The popup: what can go back, per seller">
  &nbsp;
  <img src="docs/screenshots/panel-cart.png" width="380" alt="The panel on Cardmarket's cart page">
</p>

---

## What it is for

If you put a deck together on Cardmarket, you often have dozens of cards from
different sellers in your cart, in exactly the right condition and language.
Cardmarket **empties that cart by itself**: after a while, when a
seller goes on vacation or when something is sold. All that searching is then
gone.

**Cart Saver remembers everything you put in your cart** and puts it back with one
click, as long as it is still for sale. If something was sold, it looks for a
replacement.

## What you get

| | |
|---|---|
| **Remembered automatically** | Every article in your cart is saved, cards and sealed products alike (booster boxes, displays…): seller, condition, language, foil, price and quantity, with a picture. You do not have to do anything. |
| **One click back** | One request per seller, and only what is really missing. So "1 of 2 in your cart" is topped up too. Use the checkboxes to choose what goes back. Changed your mind? *Undo*. |
| **Know what happened** | For each article you see whether the cart was emptied, whether the seller disappeared or only this article was sold, and whether the price changed. |
| **Replacements for sold cards** | The same card from the same seller, from a seller already in your cart (no extra shipping), or the cheapest similar offer. |
| **All games in one cart** | Magic, Pokémon, Yu-Gi-Oh!, One Piece, Lorcana… You choose which games go back. |
| **Favourites and lists** | Save an offer with a ☆, or your whole cart as a list ("Commander deck"), to put it back later with one click. |
| **Warned in time** | Shipping costs per seller, a notification when something disappears, and what time Cardmarket empties your cart (if Cardmarket shows it). |

## How it works

**1. Shop as usual.** Cart Saver remembers what you put in your cart. On the
cart page you see at the bottom right what has been saved, and what shipping
costs per seller.

**2. Cart emptied?** A reminder appears on every Cardmarket page, and
the icon in the toolbar counts along.

<p align="center">
  <img src="docs/screenshots/panel-reminder.png" width="380" alt="Reminder: Your cart was emptied">
</p>

**3. Put it back.** One click, and the cards are back in your cart. What
was sold gets a stamp, with *Find a replacement*.

<p align="center">
  <img src="docs/screenshots/panel-result.png" width="380" alt="Result after putting back">
  &nbsp;
  <img src="docs/screenshots/panel-replacement.png" width="380" alt="Replacement for a sold card">
</p>

The popup has everything: what can go back (per seller, with the details
when you click a card), your **favourites** and your **lists**. You make a list
with *Save as list…* in the Cart tab or in the panel on
Cardmarket.

<p align="center">
  <img src="docs/screenshots/popup-favorites.png" width="380" alt="Favourites in the popup">
  &nbsp;
  <img src="docs/screenshots/popup-carts.png" width="380" alt="Saved lists in the popup">
</p>

## Installing

Cart Saver is not in the Chrome Web Store (yet); you load it yourself:

1. **Download** the [ZIP](https://github.com/MilanVeenstra/CardmarketExtension/archive/HEAD.zip) and unzip it.
2. In Chrome, go to `chrome://extensions` and turn on **Developer mode** at the top right.
3. Click **Load unpacked** and choose the unzipped folder (the one with `manifest.json`).
4. Reload your open Cardmarket tabs.

Also works in Edge, Brave and Opera.

<details>
<summary><b>Automatic updates (Mac)</b></summary>

Want every new version to arrive by itself? Set it up once:

1. On `chrome://extensions`, find the line **Loaded from** under Cart Saver: that is your extension folder.
2. Open **Terminal**, type `cd ` and drag that folder into the window. Press Enter.
3. Run:
   ```bash
   bash scripts/autoupdate-mac.sh install "$PWD"
   ```
   Does your Mac ask for the *Command Line Tools*? Install them and repeat step 3.
4. Click ↻ on Cart Saver once.

After that, your Mac checks every 3 minutes whether there is a new version; the extension
restarts itself and open tabs ask to be reloaded. Your saved
articles are kept. A new version that would not load is
skipped, and while you are in your cart or checking out, the
extension waits before restarting. Status: `bash scripts/autoupdate-mac.sh status`,
turn off: `bash scripts/autoupdate-mac.sh uninstall`.

Use a separate folder for this (such as the unzipped ZIP), never a folder
where you work on the code yourself: the script refuses a git folder with local
changes, commits or a different branch.

</details>

## Privacy

- Everything stays in your own browser. There is no server and nothing is
  sent.
- Cart Saver only talks to Cardmarket: the site itself, through your own
  logged-in session, and Cardmarket's image server (for the pictures in
  the popup). No passwords are stored.
- Optional (off by default): download Cardmarket's public price guide once a
  day to compare prices with the trend.

## Good to know

- Cart Saver is **unofficial** and not affiliated with Cardmarket. It uses
  the same requests as the buttons on the site. If Cardmarket changes something,
  it would rather do nothing than do something wrong: a cart it cannot read
  properly is never marked as empty.
- A saved article is one offer from one seller. If that offer was sold,
  it cannot go back; use *Find a replacement* instead.
- Use it in moderation: requests are only sent after your click (or when your cart
  changed), one at a time and with a pause in between.
- Cardmarket itself says at the top of the cart: only keep articles in it that you
  really want to buy; misuse of the cart can lead to the suspension of your account.
  So use Cart Saver to put back what you want to buy, not to hold on to
  offers. That is why it never puts anything back by itself.

<details>
<summary><b>For developers</b></summary>

No build step: Chrome loads the files directly (Manifest V3, plain
HTML/CSS/JS).

```
manifest.json
src/
  shared/      store.js (data and storage), ui.js (style and components), i18n.js
  content/     cardmarket.js (knowledge of the site), refill.js (putting back),
               replace.js (replacements), widget.js (panel), favorites.js (stars),
               main.js (start-up, reading the cart)
  page/        bridge.js (requests from the page itself, over a private channel)
  popup/       popup.html/css/js
  options/     options.html/css/js
  background/  service-worker.js (badge, notifications, self-update, price guide),
               images.js (pictures for the popup)
_locales/      nl, en
scripts/       autoupdate-mac.sh (with check-build.js), make-icons.mjs
tests/         end-to-end tests against a mock Cardmarket
docs/          research, functional requirements, design brief, screenshots
```

The tests load the real extension in Chromium (Playwright) and send
`https://www.cardmarket.com` to a mock site with the same HTML and
endpoints:

```bash
npm install
npm test                          # all tests
SCREENSHOT_DIR=shots npm test     # also screenshots
CMCS_LIVE=1 npm test              # also pictures from the real Cardmarket image server
CHROMIUM_PATH=/path/to/chrome npm test   # a Chromium that is already on your computer
```

More background: [research](docs/RESEARCH.md),
[functional requirements](docs/REQUIREMENTS.md),
[analysis of the cart saver](docs/CART-SAVER-ANALYSIS.md),
[analysis for 1.6](docs/ANALYSIS-1.6.md), the
[plan for 1.7](docs/PLAN-1.7.md) and the
[design brief](docs/DESIGN-BRIEF.md).

</details>
