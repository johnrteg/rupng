# RCS Business Messaging — what it is, who can send it, and how it compares to SMS/MMS

A reference doc for RCS (Rich Communication Services), grounded in the vendor research done while building
this repo's RCS support (`apps/core/texting/src/providers/adapters/{Infobip,Telnyx,Vonage}SmsAdapter.ts`).
Numbers below are cited from each vendor's own docs where noted; the shared 3,072-char / 250KB / 100MB /
2-10-card figures are the GSMA/Google RCS Business Messaging baseline every carrier implements, not a
vendor-specific choice.

## What it is

RCS is the GSMA's ("GSM Association") **Universal Profile** standard for carrier messaging — the intended
successor to SMS/MMS. It rides over the SAME carrier messaging channel (no app install, no phone number
lookup, no data plan required beyond normal carrier connectivity) but adds a rich, app-like layer on top:
read receipts, typing indicators, high-res media, branded sender identity, and interactive content (buttons,
carousels, suggested replies) — closer to iMessage/WhatsApp than to 160-character SMS.

**RCS Business Messaging (RBM)** — sometimes now called **"RCS for Business"** — is the A2P (application-to-
person) half: a business sends from a verified **agent** (their branded identity — logo, name, verified
checkmark), not a bare phone number. This is the half every CPaaS vendor's API (and this repo's adapters)
talks to. The other half, **RCS P2P**, is person-to-person chat between consumers (Google Messages ↔ Google
Messages, or now Apple's default Messages app) — not something a business sends through, and not what
these adapters implement.

## Who can send it (the account/agent side)

Sending RCS is NOT self-serve the way sending an SMS is. Every business needs an **approved, verified agent**
before a single message goes out:

1. **Brand verification** — an authorized brand representative confirms the agent's identity and the
   requester's right to manage it on the brand's behalf (a mandatory email confirmation to the brand contact).
2. **Agent review/launch approval** — either **Google-managed** (Google reviews the agent, ~1-3 business days
   once materials are complete) or **carrier-managed** (each carrier runs its own independent vetting) —
   depending on which carriers the agent is launching on.
3. **Launch readiness checks** — the agent must be reachable by real (non-test) devices, support opt-out, and
   have its primary/secondary/opt-out conversation flows reviewed (screenshots or a walkthrough video).

This is analogous to — and in most CPaaS stacks, separate from — 10DLC brand/campaign registration for SMS;
an approved 10DLC campaign does NOT automatically grant RCS sending rights. **No CPaaS vendor exposes a way
to skip this** — it's a real, carrier/Google-gated approval process, typically days to weeks, not an
instant API call.

## Who can receive it (the device/carrier side)

- **Android** — RCS (P2P and Business) works on effectively all Android devices via Google Messages, and has
  for years; this is RCS's original and largest install base.
- **iOS** — RCS requires **iOS 18+** on iPhone XS/XR or newer, AND the carrier must have enabled RCS in that
  market. In the US, Verizon, T-Mobile, and AT&T all support RCS on iOS 18. RCS for Business (RBM) specifically
  arrived slightly later, in **iOS 18.1**, and is still rolling out market-by-market.
- **Graceful degradation is mandatory, not optional** — if the recipient's device/carrier/plan doesn't support
  RCS (feature phone, unsupported carrier, RCS disabled), every vendor's API automatically (or via an explicit
  `fallback` field, as Telnyx exposes) falls back to plain SMS/MMS. A real RCS integration therefore ALWAYS
  carries a plain-text fallback body — this is why `Texting.OutboundRequest.body` is the required fallback
  alongside the optional `rcsContent` in this repo's model, not an afterthought.
- Encryption note: end-to-end encrypted RCS (P2P, built on GSMA's MLS-based Universal Profile 3.0) is in
  active rollout as of 2026 — irrelevant to the A2P/business side, which is verified-sender, not E2E-encrypted.

## Transports — how a message actually gets there

```
Your app  →  CPaaS vendor's RCS API  →  Google's RBM platform  →  carrier network  →  Google Messages (Android)
                                                                                    →  Messages app (iOS 18+)
```

- **CPaaS vendors (Infobip, Telnyx, Vonage, Sinch, Twilio, Bandwidth, …) are resellers/aggregators**, not the
  underlying network — they hold the agent registration and API surface; the actual delivery rides Google's
  RBM platform (for Android + increasingly iOS) or, for carrier-managed launches, direct carrier RCS hubs.
  This is why the API SHAPES differ vendor-to-vendor even though the wire PROTOCOL (GSMA Universal Profile) is
  standardized — each vendor wraps the same underlying capability in its own REST dialect.
- There is no "RCS phone number" the way there's a long-code/toll-free/short-code number for SMS — RCS rides
  the SAME registered sending identity (a long code, or the agent's own branded identity) that's already
  provisioned for messaging; RCS is a CAPABILITY layered on top, not a separate number type. (This repo still
  models `Texting.NumberType` as `LONG_CODE`/`TOLL_FREE`/`SHORT_CODE` for the SMS/MMS number itself — RCS
  eligibility is a property of the agent + recipient device, checked at send time, not a 4th number type.)

## Message formats & capabilities

| Capability | What it is |
|---|---|
| **Text** | Plain message text, up to 3,072 characters (vs. SMS's 160/segment) |
| **Rich card (standalone)** | Title + description + one image/video/PDF + a row of suggestion chips — think "one interactive tile" |
| **Carousel** | 2-10 rich cards, horizontally swipeable — a real carousel needs the VENDOR's carousel endpoint, not just repeated cards (see per-provider notes below) |
| **Suggested reply** | A tappable chip that sends back its exact text as the user's reply (`postbackData` echoes it) — up to ~11 per message |
| **Suggested action** | A tappable chip that does something OTHER than reply: open a URL, dial a number, open a calendar event, share/request location |
| **Read receipts + typing indicators** | Real-time delivery/read/typing signals, like a normal chat app — SMS/MMS have neither |
| **Verified sender identity** | The agent's logo, display name, and a verified checkmark render in the recipient's native Messages app — no "unknown sender" ambiguity |
| **High-res media** | Images/video/PDF up to ~100MB per file (vs. MMS's ~1-5MB carrier-imposed cap) |

## Limits — per provider (as implemented/researched for this repo)

The core numeric limits are the **shared GSMA/Google RBM baseline** — carriers don't get to redefine the
protocol. What actually DIFFERS per vendor is API surface + which features their API exposes:

| | Text limit | Message payload cap | Media size | Card title / description | Carousel cards | Suggestions | This repo's status |
|---|---|---|---|---|---|---|---|
| **Infobip** | 3,072 chars | 250 KB | 100 MB (100 MB combined for a carousel) | — / 2,000 chars | 2-10 (real API: `/rcs/2/messages`, `CAROUSEL` type) | up to 11/message, 4 buttons/card | Text + single CARD real; carousel sends first-card only (this adapter's carousel schema on the bulk endpoint wasn't independently verified — see the adapter's header) |
| **Telnyx** | 3,072 chars | 250 KB | 100 MB | 200 chars / 2,000 chars | 2-10 (real, verified `carousel_card` support) | up to 11/message | Text, single CARD, **and real carousel** — the most complete of the three implemented here |
| **Vonage** | 3,072 chars | 250 KB | 100 MB | — | 2-10 per Vonage's own docs (not implemented in this repo) | up to 11/message per Vonage's docs (a specific standalone-card tutorial example used 4 — worth double-checking against the live API before trusting either number) | Text + single CARD real; carousel not implemented (first-card fallback) |
| **Bandwidth** | 3,072 chars (published) | 250 KB (published) | 100 MiB (published) | 200 / 2,000 chars (published) | 2-10 (published) | up to 11 (published) | **Not implemented** — this repo has no real RCS send call for Bandwidth at all |
| **Twilio / SignalWire / Sinch / Broadnet** | — | — | — | — | — | — | **Not implemented** — RCS was only built for Infobip/Telnyx/Vonage in this repo; these four still send SMS/MMS only |

**Suggested-reply-specific sub-limits** (from Infobip's docs, and broadly consistent across vendors): reply
text ≤ 25 characters, postback data ≤ 2,048 characters, media/file URLs ≤ 2,048 characters.

## RCS vs. SMS vs. MMS

| | SMS | MMS | RCS |
|---|---|---|---|
| **Text length** | 160 chars/segment (concatenated for longer) | 160 chars + media | 3,072 chars |
| **Media** | None | Images/short video, ~1-5MB carrier cap | Images/video/PDF up to 100MB |
| **Rich content** | None | None | Rich cards, carousels, buttons |
| **Interactivity** | None (reply is just another SMS) | None | Suggested replies/actions (structured, app-like taps) |
| **Sender identity** | Bare phone number | Bare phone number | Verified brand name + logo + checkmark |
| **Delivery signals** | Carrier DLR only (sent/delivered/failed) | Carrier DLR only | DLR + read receipts + typing indicators |
| **Numbering** | Long code / toll-free / short code | Long code / toll-free / short code | No separate number — rides the existing sending identity; eligibility is per-device |
| **Registration burden** | 10DLC brand/campaign (US) or none (toll-free/short code) | Same as SMS | 10DLC/toll-free/short-code registration for the NUMBER, **plus** a separate agent verification/launch approval for RCS itself |
| **Universal reach** | Works on every phone, every carrier, worldwide | Works on nearly every phone/carrier | Only Android (broad) + iOS 18+ on an RCS-enabled carrier — **always needs an SMS/MMS fallback** |
| **Cost model** | Cheapest, most standardized | Slightly more than SMS (media) | Vendor/carrier-specific; generally priced per-message like SMS but can carry premium rich-card pricing |
| **Where it's the right choice** | Universal reach, OTP/alerts, anything that must work on every device | Photo/short-video attachments where RCS isn't guaranteed | Marketing/support flows where rich interactivity + verified branding matter AND you can tolerate a fallback path for unsupported devices |

## The practical takeaway

RCS is **SMS's replacement in progress, not a drop-in upgrade you flip on** — it needs its own agent
verification (separate from 10DLC), its API shape differs per vendor even though the wire limits are
standardized, carousel support in particular varies wildly by vendor's own API maturity (Telnyx: real;
Infobip/Vonage: first-card fallback in this repo), and it ALWAYS needs a plain-text SMS fallback for the
devices/carriers/markets that don't support it yet. Treat it as an enhancement layered on top of an existing
SMS/MMS send path, never a replacement for one.
