# Plan 1.7: one writer, and knowing when your cart is emptied

Two points from the 1.6 analysis that were still open and that have to be done now:

- **B6, concurrent writes.** Cardmarket tabs, the popup, the settings page and the
  background all write to the same storage. When that happens at the same time,
  work gets lost.
- **S9, when the cart is emptied.** Cart Saver now only notices that your cart is empty
  when you click around on Cardmarket again. You want to know when it happens, and
  preferably in advance.

Status: plan (9 October 2026). Nothing built yet.

---

## Part A: concurrent writes (B6)

### How it works now

All data lives in a few large blocks in `chrome.storage.local`: `cmcs.items`,
`cmcs.meta`, `cmcs.job`, `cmcs.favorites`, `cmcs.carts`, `cmcs.settings` and `cmcs.thumbs`.
A change always goes like this: read the block, change it, write the whole block back
(`store.update()` in `src/shared/store.js`).

`store.update()` puts changes in a queue, but **only within one part**. Every
tab, the popup, the settings page and the background has its own queue. If
two parts read the same block at the same time, the last writer overwrites the change
of the first. `chrome.storage` has no transactions and no "write only if nobody
else changed anything"
([chrome.storage](https://developer.chrome.com/docs/extensions/reference/api/storage)).

The Web Locks that already exist (`cmcs.refill`, `cmcs.sync`) only half help. In a
content script they belong to the page (www.cardmarket.com). So they apply between
Cardmarket tabs, but not between a tab and the popup or the background.

Writes happen in about 75 places in 9 files.

### Measured

A trial with the real extension in Chromium: the background and the popup both add
an article 200 times, at the same time.

| Setup | Kept out of 400 | Cost per write |
| --- | --- | --- |
| Now (every part writes itself) | 207–223, so **177–193 lost** | 2.7 ms |
| Only the background writes, the popup sends a message | **400, nothing lost** | 2.3 ms (4–6 ms with 400 at once) |

This is the worst case, with constant load. In normal use it happens less often,
but the mechanism is real. The message route is not slower.

### Where it goes wrong in practice

1. **Undo during a refill.** The tab that puts articles back writes a heartbeat into
   `cmcs.job` every 5 s. If you click "Undo" in the popup exactly between the reading
   and the writing of that heartbeat, your request disappears without you noticing.
2. **Two Cardmarket tabs.** Tab A reads the cart (`cmcs.items`), while
   tab B writes away the results of the refill. They use different
   locks. Result: results lost, or a removed article comes back.
3. **Background against tab.** The daily price update and the clean-up of old
   articles write `cmcs.items` while a tab updates the cart. Worse still:
   a change from a tab itself triggers a write in the background via
   `storage.onChanged`. That gives two writers right after each other.
4. **Settings.** An import or "Delete everything" while a tab is open. The tab
   then writes its old copy back.
5. **`cmcs.meta`.** Collapsing the panel, confirming your account or dismissing the
   "cleaned up" notice gets lost if a tab saves a cart reading at that moment.

### Considered

| Approach | Why or why not |
| --- | --- |
| Web Locks everywhere | Content scripts and extension pages do not share a lock (different origin). Does not solve 3 and 4. |
| Version number per block ("only write if it is still version N") | Without a real compare-and-swap a gap remains between checking and writing. Smaller gap, not closed. |
| Every article its own key | Fewer collisions, but `meta` and `job` stay one block and reading the cart still touches many articles. Big migration. Useful for later, though (smaller `onChanged` messages). |
| IndexedDB with transactions | Content scripts see the IndexedDB of cardmarket.com, not that of the extension. So they can only reach it through the background, and then it might as well go through `chrome.storage`. |
| **One writer: the background** | One queue for all changes, so nothing is lost (measured). Just as fast. Reading stays as it is. **Chosen.** |

### Design

**Only the service worker writes.** All other parts send a command.

- `store.js` keeps the same functions (`syncCart`, `removeItems`, `takeCart`, …). In the
  service worker they carry out the change themselves, in the existing queue. Everywhere else
  they send `chrome.runtime.sendMessage({ type: 'cmcs.write', op, args, opId })` and wait
  for the answer. So for most calls nothing changes.
- **Commands are data, not functions.** A function cannot travel in a message. The
  calls with their own function (`updateMeta(fn)`, `updateJob(fn)`, `updateCart(id, fn)`,
  the import in the settings) become named commands:

  | Now | Becomes |
  | --- | --- |
  | `updateMeta((m) => ({ ...m, collapsed }))` and the like | `patchMeta({ collapsed })` |
  | updating `markLeftByUser`, `userRemoved` | `markUserRemoved(ids, at)` |
  | `applyCart` in `main.js` (items + meta in four steps) | one command `applyCartReading(reading)`: items and meta in one go |
  | heartbeat, claiming, undo, acknowledging (`updateJob(fn)`) | `claimJob`, `beatJob`, `patchJob(jobId, runner, patch)`, `requestUndo(jobId)`, `acknowledgeJob`, `dismissJob` |
  | `toggleFavorite(article)` | `setFavorite(article, on)`: running it twice gives the same result |
  | `updateCart(id, fn)` | `renameCart(id, name)`, `setCartItems(id, items)` |
  | import and "Delete everything" in the settings | `importData(payload)`, `clearAll()` |
  | prices and clean-up in the background | stay local (they already run in the writer) |

- **Several blocks at once.** A command that touches items and meta (reading the cart,
  cleaning up, finishing a refill) writes both in one `storage.set`. Then nobody sees
  a half result.
- **Reading stays direct.** `getItems()` and the like, plus `storage.onChanged` for
  redrawing. That is safe: only writing collides.

**If the service worker sleeps or stops.** Chrome stops it after 30 s without work. A message
wakes it up and gives it more time
([lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)).
The listener sits at the top of the script, so messages sent during start-up arrive.
Two edge cases:

- *"Receiving end does not exist"* (it is still starting): the command was not carried out.
  Retry after 100 ms, at most 3 times.
- *It stops in the middle of a command, after writing but before the answer*: a retry
  must then not count twice. Every command gets an `opId`. The writer
  remembers the last 200 in `chrome.storage.session` (survives a restart of the
  service worker within the same browser session) and skips duplicates.

**After an update of the extension** old tabs can no longer do anything (no storage, no
messages). That is already the case now. The data format stays the same, so no migration
is needed.

**Separate heartbeat (small, optional).** Move the heartbeat of a refill job to its own
key `cmcs.beat`. Then `cmcs.job` is no longer rewritten in full every 5 s and
`isHeartbeatOnly` no longer needs to exist.

### Tests

1. **The race as a test (write it first; it fails now).** Popup, background and two
   Cardmarket tabs write 200 times at the same time. Expected: nothing lost.
2. **Undo during the heartbeat.** An undo request 50 times while the heartbeat
   runs. The request always arrives.
3. **Service worker stopped.** Via CDP (`ServiceWorker.stopAllWorkers`) in the middle of a series
   of commands. Everything arrives, nothing twice (`opId`).
4. **Guard.** A test that searches `src/`. Outside `store.js` no `chrome.storage.local.set`
   or `remove`, and outside the service worker no `update*(fn)`. Then it cannot creep back in.
5. The 90 existing tests stay green.

### Steps (each its own commit, tested and pushed)

1. Add the race test + guard test (red).
2. Command list in `store.js` + message route in the service worker, with `opId` and
   retries. Commands that already have a name move over first.
3. Convert the function calls: meta, job, favourites, lists, settings. `applyCart`
   becomes one command.
4. Separate heartbeat, clean-up, version 1.7.0.

---

## Part B: knowing when Cardmarket empties your cart (S9)

### What is known

Cardmarket does not document it. The help centre and the terms only mention the cart
when completing a purchase. What there is:

- **A notice with a time.** 2021: a yellow notice at the top saying the cart would be
  emptied automatically "um 19 Uhr" (at 7 pm). Someone else writes that their cart is always
  emptied at 00:10 ([mtg-forum.de, p. 918](https://www.mtg-forum.de/topic/116960-mkm-magickartenmarkt-cardmarket/page-918)).
- **2023:** emptied "irgendwann Vormittags" (some time in the morning). You see a notice that the cards
  leave the cart at a certain time. Articles in your cart are blocked for
  others. According to one user, the seller can only take them out themselves after at least an hour
  ([mtg-forum.de, p. 1040](https://www.mtg-forum.de/topic/116960-mkm-magickartenmarkt-cardmarket/page-1040)).
- **Older posts (2014–2016)** in the same topic (p. 270, 437, 493): varying
  stories (a quarter of an hour, 1–2 hours, blocked for more than 12 hours). Not confirmed.
- **Own observation, 9 October 2026.** The cart page with articles showed no time,
  only "Reminder: Please only keep items in your cart that you intend to purchase.
  Abuse of the shopping cart may result in account suspension." A second look later
  that day got stuck on the login page.

The conclusion: the rule varies or has changed. Sometimes there is a time on the page,
often not. So Cart Saver has to **observe and learn it itself**. Cardmarket's text is
a bonus when it is there.

### What Cart Saver does now

- On the cart page: save everything, and `readCartExpiry()` looks for a notice with a
  time ("19:00", "in 45 minutes").
- On other pages: if the number next to the cart in the header has changed, or the last
  reading is older than 15 minutes, the cart is fetched once.
- If the cart is empty while there were articles in it, they get `missingReason:
  'emptied'`. A notification only appears when the tab is in the background.
- With a known time: a notification 5 minutes in advance.

The gap: without clicking around on Cardmarket, nobody notices anything. And the time of
emptying is not stored anywhere. There is `missingSince`, but that is the moment of discovery,
not of emptying.

### Plan

**B1. A log of emptyings.** Every time the extension discovers that the cart
was emptied, a line goes into `cmcs.cartLog` (the last 50, only on your own
computer):

```
{ foundAt, lastSeenFullAt, count, whole: true|false, oldestAddedAt, lastAddedAt, notice }
```

The real moment lies between `lastSeenFullAt` (last reading with articles) and `foundAt`.
`whole` tells "completely empty" (Cardmarket) apart from "a seller disappeared" (sold,
or the seller removed it). Only whole emptyings count towards predicting.

**B2. Making the margin small: a light check.** As long as a Cardmarket tab is
open and there is something in your cart, one tab fetches the cart every 20 minutes.
That is the same request as now when clicking around (with the existing lock `cmcs.sync`, so
one tab at a time). In doing so:

- never more often than once every 20 minutes, and stop at once at a Cloudflare check (which
  is never solved) or a logged-out page;
- one extra check one minute after an announced or predicted time. Then the
  moment is known almost to the minute.

Without an open tab the background could fetch it itself. First find out whether Chrome sends
your login cookie along and whether Cloudflare allows it. Hence a separate setting,
**off** by default.

**B3. Keeping what Cardmarket says, word for word.** Every notice on the cart page with words
about the cart and a time is kept, with the raw text (at most 300 characters, the
last 20). `readCartExpiry()` also reads notices after the fact ("… um 09:12 aus dem
Warenkorb entfernt", i.e. "… removed from the cart at 09:12"). Those give the exact time for the log. After a few weeks
we then know what the real text says, instead of guessing. Under "Data" in the
settings you can view them and export them for a bug report.

**B4. Learning and predicting.** From 3 whole emptyings on:

- *how long after the last addition* (median and spread);
- *around what time of day* (for a fixed moment per day, such as 00:10).

The approach with the smallest spread wins, but only if that spread is small enough
(for example under 45 minutes). Otherwise no prediction. Better nothing than something wrong.

**B5. Showing and warning.**

- The popup and the panel show the last time: "Cardmarket emptied your cart on
  Thu 9 Oct between 08:40 and 09:00 (7 articles)". The time window is honest about what we know.
- With a prediction: "Probably emptied around 09:00". A notification 15 minutes in
  advance, with the word "probably". A time from Cardmarket itself always takes precedence.
- The "Your cart was emptied" notice also appears when the tab is visible, but then as a
  strip in the panel instead of a system notification. With the "Put … back in your cart" button next to it,
  as now.

**Safety.** Read only. Cart Saver never buys anything, and never takes anything out of your
cart. The light check is an ordinary page read, just like clicking around, and Cloudflare
is never bypassed.

### Tests (mock Cardmarket)

1. Cart emptied at time T, tab open: the light check finds it within 20
   minutes. The log is correct (`lastSeenFullAt ≤ T ≤ foundAt`, `whole: true`).
2. One seller gone: log entry with `whole: false`, does not count towards the prediction.
3. Notices in en, de, nl, fr ("um 19 Uhr", "removed at 09:12", "vandaag om 00:10"): read
   correctly, raw text kept.
4. Three artificial emptyings with a fixed pattern give a prediction.
   Varying moments give none.
5. The light check stops at Cloudflare, at an empty cart, without an open tab, and
   at a logged-out page. Never more often than once every 20 minutes.
6. Only one tab checks, even with five open.

### Steps

1. Log (B1) + showing the last time (B5, first part).
2. Light check (B2) with tests.
3. Keeping notices and reading them after the fact (B3).
4. Predicting and warning in advance (B4, B5).
5. Optional: checking from the background, after the cookie and Cloudflare trial.

---

## Order

Part A first. The log and the light check from part B also write from
tabs themselves. They then need to go through the new route right away. Then part B. The prediction can
only do something once the log has run for a few weeks, so releasing step B1 early
pays off.

The trial scripts are not in the repository. The race test from step A1 takes over that role.
