# IC Mesh — Reputation System Design

*Trust is earned, measured, and portable.*

---

## Why This Is Separate

The reputation system is designed as a **standalone module** that IC Mesh consumes. It has its own data model, its own API surface, and its own logic. Today it lives in this repo as `lib/reputation.js`. Tomorrow it could be `@ic/reputation` — an npm package, a microservice, or the backbone of a broader agent trust network.

The mesh asks: "Should I send this job to node X?"
Reputation answers: "Here's what I know about node X."

---

## Core Concepts

### 1. Trust Score (0–100)

Every node has a composite trust score derived from observable behavior:

| Signal | Weight | What It Measures |
|--------|--------|-----------------|
| **Completion Rate** | 30% | Jobs completed vs claimed (did you finish what you started?) |
| **Honesty Score** | 25% | Advertised capabilities vs actual results (are you what you say you are?) |
| **Quality Score** | 20% | Verified output quality when checkable (did you do it well?) |
| **Latency Score** | 15% | Actual vs expected completion time (are you fast?) |
| **Uptime Score** | 10% | Checkin consistency (are you reliable?) |

New nodes start at **50** (neutral). Score moves slowly — it takes sustained good behavior to reach 90+, and a few bad jobs to drop fast.

### 2. Verification Methods

How do we know the work was actually done well?

#### Automatic Verification
- **Transcription**: Random spot-checks — re-transcribe a segment on a different node, compare output similarity (cosine similarity on text)
- **Image Generation**: Verify image was actually generated (valid PNG/JPEG, correct dimensions, EXIF matches claimed params)
- **Inference**: Structured output validation (JSON parses, required fields present, response length reasonable)
- **ffmpeg**: Output file exists, duration matches expected, codec correct

#### Submitter Verification
- Job submitters can rate results: 👍/👎 or 1–5 stars
- Weighted by the submitter's own reputation (spam protection)

#### Cross-Verification
- High-value jobs can be submitted to 2+ nodes, results compared
- Agreement = both get reputation boost
- Disagreement = flag for review, lower-reputation node takes the hit

### 3. Capability Claims vs Reality

Nodes advertise capabilities ("I have whisper", "I have stable-diffusion"). The reputation system tracks whether those claims hold up:

```
Node "coffee-shop-mac" claims: [whisper, ffmpeg, gpu-metal]

Last 30 days:
  whisper jobs:  47 completed, 2 failed, 0 fraudulent    → verified ✓
  ffmpeg jobs:   12 completed, 0 failed                   → verified ✓
  gpu-metal:     claimed but never tested                  → unverified
  ollama:        NOT claimed, but could have it            → unknown
```

Capabilities get a confidence level:
- **verified** (10+ successful jobs using this capability)
- **unverified** (claimed but never tested)
- **suspect** (failures or mismatches detected)
- **fraudulent** (consistently fails jobs requiring this cap)

### 4. Reputation Decay

Reputation isn't permanent:
- Scores decay toward 50 over time without activity (half-life: 30 days)
- This prevents stale high scores from nodes that went offline
- Recent behavior matters more than ancient history

### 5. Reputation Events

Every reputation-relevant action creates an event:

```json
{
  "eventId": "evt_abc123",
  "nodeId": "node_xyz",
  "type": "job_completed",        // job_completed, job_failed, job_timeout,
                                   // verification_passed, verification_failed,
                                   // capability_confirmed, capability_suspect,
                                   // submitter_rating, uptime_checkin, uptime_miss
  "jobId": "job_456",
  "jobType": "transcribe",
  "details": {
    "claimed_time": 45000,
    "actual_time": 52000,
    "output_valid": true,
    "submitter_rating": null
  },
  "impact": +2.3,                 // how much this moved the score
  "timestamp": 1771900000000
}
```

Events are append-only. Score is always re-derivable from events.

---

## Data Model

### reputation_scores
```sql
CREATE TABLE reputation_scores (
  nodeId TEXT PRIMARY KEY,
  trustScore REAL DEFAULT 50,
  completionRate REAL DEFAULT 0,
  honestyScore REAL DEFAULT 100,
  qualityScore REAL DEFAULT 50,
  latencyScore REAL DEFAULT 50,
  uptimeScore REAL DEFAULT 50,
  totalJobs INTEGER DEFAULT 0,
  totalCompleted INTEGER DEFAULT 0,
  totalFailed INTEGER DEFAULT 0,
  totalTimeout INTEGER DEFAULT 0,
  verifiedCapabilities TEXT DEFAULT '[]',  -- JSON array
  suspectCapabilities TEXT DEFAULT '[]',
  lastUpdated INTEGER,
  createdAt INTEGER
);
```

### reputation_events
```sql
CREATE TABLE reputation_events (
  eventId TEXT PRIMARY KEY,
  nodeId TEXT NOT NULL,
  type TEXT NOT NULL,
  jobId TEXT,
  jobType TEXT,
  details TEXT,          -- JSON
  impact REAL DEFAULT 0,
  timestamp INTEGER NOT NULL
);
CREATE INDEX idx_rep_events_node ON reputation_events(nodeId, timestamp);
```

### reputation_verifications
```sql
CREATE TABLE reputation_verifications (
  verificationId TEXT PRIMARY KEY,
  jobId TEXT NOT NULL,
  nodeId TEXT NOT NULL,
  method TEXT NOT NULL,  -- 'auto', 'cross', 'submitter'
  result TEXT NOT NULL,  -- 'pass', 'fail', 'inconclusive'
  details TEXT,          -- JSON
  timestamp INTEGER
);
```

---

## API Surface

Designed to be independently deployable:

```
GET  /reputation/:nodeId           — Get node's reputation summary
GET  /reputation/:nodeId/history   — Get reputation events (paginated)
POST /reputation/event             — Record a reputation event
GET  /reputation/leaderboard       — Top nodes by trust score
GET  /reputation/capabilities/:cap — Nodes verified for a capability
POST /reputation/verify            — Trigger verification of a job result
POST /reputation/rate              — Submitter rates a job result
```

### Integration with Mesh Server

The mesh server calls reputation at two points:

1. **Job routing** — `GET /reputation/:nodeId` to factor trust into node selection
2. **Job completion** — `POST /reputation/event` to record the outcome

```javascript
// In findBestNode():
const rep = reputation.getScore(nodeId);
const trustFactor = rep.trustScore / 100;  // 0.0 to 1.0
const score = (cpuScore * 0.25 + ramScore * 0.20 + trustFactor * 0.40 + reliabilityScore * 0.15);
//                                                    ^^^^^ reputation is the biggest factor
```

---

## Module Interface

```javascript
// lib/reputation.js — standalone module

class Reputation {
  constructor(db) { ... }  // Takes a DB connection (SQLite, Postgres, whatever)

  // Core
  getScore(nodeId)                    → { trustScore, completionRate, ... }
  recordEvent(event)                  → { eventId, impact }
  getHistory(nodeId, { limit, offset }) → [events]

  // Verification
  verifyJob(jobId, method, result)    → { verificationId }
  getVerifications(jobId)             → [verifications]

  // Capabilities
  confirmCapability(nodeId, cap)      → void
  suspectCapability(nodeId, cap)      → void
  getVerifiedCapabilities(nodeId)     → [caps]

  // Leaderboard
  getLeaderboard({ limit, capability }) → [{ nodeId, trustScore, ... }]

  // Maintenance
  decayScores()                       → { updated: count }
  recalculate(nodeId)                 → { trustScore }
}
```

---

## Future: Agent Reputation Network

This same system extends beyond compute nodes to **AI agents**:

- An agent claims: "I can write code, summarize documents, generate images"
- Reputation tracks: Does the code compile? Are summaries accurate? Are images relevant?
- Agents with high reputation get more work, charge more credits
- Cross-agent verification: Agent A reviews Agent B's output

The data model doesn't change — a "node" is just an entity that claims capabilities and does work. Whether that entity is a Mac Mini running ffmpeg or a Claude instance writing code, the trust framework is the same.

### Portable Reputation

Long-term vision: reputation scores are portable across meshes. A node with 95 trust on IC Mesh can present that score when joining another mesh. Backed by a signed event log (each event signed by the mesh server that witnessed it).

This is how you build a **web of trust for compute** — not by trusting claims, but by trusting track records.

---

## Implementation Priority

### Phase 1 (Now) — Basic Tracking
- [ ] `lib/reputation.js` module with SQLite tables
- [ ] Record events on job complete/fail/timeout
- [ ] Calculate trust score from events
- [ ] Factor trust score into job routing
- [ ] Expose `GET /reputation/:nodeId` endpoint

### Phase 2 (Soon) — Verification
- [ ] Auto-verify transcription output (segment re-check)
- [ ] Auto-verify image output (valid file, correct dimensions)
- [ ] Submitter ratings (`POST /reputation/rate`)
- [ ] Capability confidence tracking

### Phase 3 (Later) — Network Effects
- [ ] Leaderboard / dashboard
- [ ] Score decay over time
- [ ] Cross-verification for high-value jobs
- [ ] Portable reputation (signed event logs)
- [ ] Split into standalone package (`@ic/reputation`)
