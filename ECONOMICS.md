# IC Mesh — Economics & Currency Design

*How ints work, how they become real money, and how IC sustains itself.*

---

## The Currency: ints

**1 int = 1 second of compute.**

- Integer only. No fractions, no floats.
- Zero-sum: every job creates +N for the worker and -N for the requester. Total across all accounts always equals zero.
- Addition and subtraction only. The ledger is dead simple.

A 45-second transcription costs 45 ints. A 120-second image generation costs 120 ints. You earn ints by doing work. You spend ints by submitting work.

---

## Three Signals, One Decision

When an agent or user decides whether to send a job to a node, they look at three things:

### 1. Reputation (BackRub)
The evidence dossier — not a score, but a track record. How many jobs completed, how many failed, how many cross-verified against peers. The agent reads the evidence and decides for itself.

### 2. Ints Balance
Skin in the game. A node at +5,000 ints has contributed 5,000 seconds of real compute to the network. A node at -200 has consumed more than it's given. Balance isn't good or bad — it's context. But it tells you whether this participant is a net contributor or net consumer.

### 3. Capability Advertisement
What the node claims it can do (whisper, stable-diffusion, ffmpeg, ollama) and whether those claims are verified through actual job completions.

These three together are sufficient. No votes, no ratings, no human judgment needed.

---

## The API Credits Model

This is the well-understood path. It's how OpenAI, Anthropic, Twilio, AWS, and every cloud API monetizes. Users pre-purchase credits, spend them on usage. No one calls it "cryptocurrency" — it's just how you pay for a service.

### How It Works for IC Mesh

**Buying compute (consumer side):**
1. User visits IC Mesh dashboard or API
2. Purchases ints with USD: $10 → 10,000 ints (at $0.001/int)
3. Their account is credited +10,000 ints
4. IC's reserve account goes -10,000 ints (IC "sells" its ints)
5. User submits jobs, balance decreases as work is done
6. When balance gets low, they buy more

This is identical to buying OpenAI API credits. Pre-pay, consume, top up.

**Earning compute (provider side):**
1. Node joins the mesh, contributes idle compute
2. Earns ints as it completes jobs (automatically)
3. Accumulates a positive int balance over time
4. Can redeem ints for USD: 10,000 ints → $8 (at $0.0008/int)
5. IC buys back the ints at a slightly lower rate (the spread)

This is like being a compute provider on any marketplace — you do work, you get paid.

### The Spread

IC buys and sells ints at slightly different prices. This spread is IC's revenue:

| Action | Price | Example |
|--------|-------|---------|
| Buy ints (consumer) | $0.001/int | $10 → 10,000 ints |
| Sell ints (provider) | $0.0008/int | 10,000 ints → $8 |
| IC spread | $0.0002/int | IC keeps $2 per 10,000 ints cycled |

The spread is 20%. This is comparable to:
- App Store: 30% cut
- Uber: 25% cut
- Fiverr: 20% cut
- IC Mesh: 20% cut

This replaces the current hardcoded 20% "network fee" with something that has real dollar value.

### Why This Works

**For consumers (people who need compute):**
- Cheaper than cloud. A 45-second Whisper transcription on the mesh costs 45 ints = $0.045. On AWS/GCP it costs $0.10-0.30+.
- No infrastructure to manage. Submit a job, get results.
- Pay-as-you-go. No minimums, no subscriptions, no reserved instances.

**For providers (people with idle machines):**
- Passive income from hardware you already own.
- A Mac Mini earning 50,000 ints overnight = $40/month in real money, just from idle compute.
- No setup beyond running the mesh client.

**For IC (the organization):**
- Revenue from the spread on every transaction.
- No hardware costs — the network IS the infrastructure.
- Grows with the network: more jobs = more spread revenue.

---

## IC as the Exchange

IC operates as the sole exchange for ints ↔ USD. This is the "central bank" role, but it's really just an API credit system:

### IC's Reserve

IC maintains two reserves:
1. **Int reserve** — ints earned from the 20% network fee on every job, plus ints bought back from providers
2. **USD reserve** — dollars received from consumers purchasing ints

These flow in a cycle:

```
Consumer buys ints → USD flows to IC → IC holds USD
Provider earns ints → requests cashout → IC pays USD, receives ints
IC holds ints → sold to next consumer → cycle repeats
```

IC's profit is the spread between buy and sell price. The reserves balance themselves through natural supply and demand.

### Pricing

Initial pricing: **$0.001 per int** (buy side).

This means:
| Job Type | Typical Duration | Cost in ints | Cost in USD |
|----------|-----------------|--------------|-------------|
| Transcription (base model) | 30-60s | 30-60 | $0.03-0.06 |
| Transcription (large model) | 120-300s | 120-300 | $0.12-0.30 |
| Image generation (SD) | 30-120s | 30-120 | $0.03-0.12 |
| LLM inference (7B) | 5-30s | 5-30 | $0.005-0.03 |
| Video transcode (1 min) | 60-180s | 60-180 | $0.06-0.18 |
| ffmpeg processing | varies | varies | varies |

These prices are **dramatically cheaper** than cloud equivalents because:
- No data center overhead
- No corporate margins (AWS markup is 60%+)
- Providers are using hardware they already paid for
- Idle compute has near-zero marginal cost

### Price Discovery

Initially IC sets the price. Over time, supply and demand adjust it:
- If demand exceeds supply (too many jobs, not enough nodes) → price goes up → attracts more providers
- If supply exceeds demand (lots of idle nodes, few jobs) → price goes down → attracts more consumers
- IC adjusts the buy/sell prices to maintain equilibrium

This is a managed float, not a free market. IC is the market maker. Simple, predictable, no speculation.

---

## Regulatory Position

**This is not cryptocurrency.** It's API credits for a compute service, with a provider payout program.

Precedent:
- **OpenAI**: You buy credits, spend them on API calls. No one calls this crypto.
- **Twilio**: You buy credits, spend them on SMS/calls. Straightforward.
- **AWS**: You pre-pay for compute hours. Standard business.
- **Mechanical Turk**: Workers do tasks, earn money, cash out. This is the closest analog.

The key distinctions from crypto:
- Ints are **not traded peer-to-peer** (only through IC's exchange)
- Ints have **no speculative value** (price is managed, not market-driven)
- IC is the **sole issuer and redeemer** (like a company gift card)
- The underlying asset is **compute time**, not a speculative token

This positions IC Mesh as a **compute marketplace** (like AWS Marketplace or Mechanical Turk), not a financial instrument.

For provider payouts, IC operates like any marketplace that pays contractors: 1099 reporting for US providers earning over $600/year.

---

## Bootstrap Strategy

### Phase 1: Internal (Now)
- Ints exist, jobs settle automatically
- No USD conversion
- Participants trade compute for compute
- Build the network, prove it works
- "Your Mac earned 2,847 ints while you slept" — the engagement hook

### Phase 2: Credits (Traction)
- IC sells ints for USD (consumer side only)
- Providers earn ints but can't cash out yet
- This funds IC operations and proves demand
- Like early AWS: pay to use, but providers are internal

### Phase 3: Full Exchange (Scale)
- Providers can cash out ints for USD
- IC operates the exchange with the spread
- Provider payout program (PayPal, Stripe, bank transfer)
- IC earns revenue from the spread
- Real passive income for node operators

### Phase 4: Enterprise (Growth)
- API access for companies to submit batch jobs
- Volume pricing (buy 1M ints at a discount)
- SLAs for guaranteed compute availability
- Enterprise dashboard with usage analytics

---

## The Pitch

### To Providers (Node Operators):
> "Your computer sits idle 80% of the time. Join IC Mesh, and those idle cycles earn you money. Install the client, let it run, wake up to earnings. A Mac Mini can earn $30-50/month just from spare compute."

### To Consumers (Developers/Teams):
> "Cloud compute is expensive and complex. IC Mesh gives you transcription, image generation, LLM inference, and media processing at a fraction of the cost. Buy ints, submit jobs, get results. No infrastructure to manage."

### To the Community:
> "We're building a distributed compute network owned by its participants. Every node earns its share. No VC, no data centers, no corporate middlemen. Just people sharing compute and getting paid for it."

---

## Open Questions

1. **Minimum cashout** — What's the minimum ints for provider withdrawal? (Suggest: 50,000 ints = $40)
2. **Negative balance limits** — How far negative can a node go? (Tied to reputation: new = -100, established = -10,000)
3. **Price adjustment frequency** — How often does IC adjust the buy/sell price? (Suggest: monthly, based on supply/demand)
4. **Geographic pricing** — Same price globally, or regional? (Suggest: global, simple)
5. **Bulk discounts** — At what volume? (Suggest: 100K+ ints = 10% discount)
6. **Provider tiers** — Guaranteed availability bonuses? (e.g., 99% uptime = 1.5x earning rate)
