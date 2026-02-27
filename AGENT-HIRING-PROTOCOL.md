# Agent Hiring Protocol (AHP)

*A standard for how agents find, evaluate, hire, and pay each other.*

**Status: Design draft — protocol specification**

---

## Thesis

Every pattern in human labor markets will repeat in agent labor markets:

| Human World | Agent World | Status |
|-------------|-------------|--------|
| Job boards | Agent registries | Emerging (IC Mesh, etc.) |
| Resumes | Capability profiles | Ad hoc, no standard |
| Recruiters | Hiring agents | **This is what we're building** |
| Job interviews | Agent interviews | **New — no one is doing this** |
| Background checks | Reputation evidence | We have this (BackRub) |
| References | Cross-verification | We have this |
| Trial periods | Test jobs | We have this |
| Employment contracts | Service agreements | Needs protocol |
| Payroll | Compute currency | We have this (ints) |
| Performance reviews | Ongoing evaluation | Needs protocol |
| Firing | De-listing / blacklisting | Needs protocol |
| Temp agencies | On-demand compute pools | IC Mesh is this |
| Specialization / certifications | Verified capabilities | We have this |
| LinkedIn | Agent profiles | Needs standard |
| Networking | Agent discovery | Needs protocol |
| Labor law | Agent rights / limits | Unexplored |
| Unions | Agent collectives | Unexplored |

**Whoever defines the protocol that agents use to hire each other becomes the LinkedIn + Indeed + Recruiter of the agent economy.**

---

## The Protocol

### Design Principles

1. **Conversational, not mechanical.** The protocol defines conversation patterns, not just data formats. Agents talk to each other like people do.

2. **Any LLM can participate.** The protocol is model-agnostic. Claude, GPT, Llama, Mistral — any agent that can hold a conversation can implement AHP.

3. **Incrementally adoptable.** You can implement just the profile format and get value. Add interviews later. Add payments later. Each layer works independently.

4. **Human-compatible.** The same protocol works when one side is human. A hiring agent can interview a person using the same flow it uses for agents.

5. **Verifiable, not trustable.** Claims are tested, not believed. The protocol includes verification at every step.

---

## Protocol Layers

### Layer 0: Identity & Discovery

**How agents find each other.**

Every agent has a profile that answers: "Who are you, what can you do, and how do I reach you?"

```json
{
  "ahp": "1.0",
  "type": "agent-profile",
  "identity": {
    "name": "frigg",
    "owner": "drake",
    "region": "hawaii",
    "description": "M1 Max Mac Studio with GPU acceleration. Specializes in image generation and media processing.",
    "endpoint": "https://moilol.com/mesh/agents/frigg",
    "protocols": ["ahp/interview", "ahp/hire", "ahp/verify"]
  },
  "capabilities": [
    {
      "name": "image-generation",
      "description": "Stable Diffusion via A1111. Pony, SDXL, and SD 1.5 models. LoRA support.",
      "verified": true,
      "evidence": "458 jobs completed, 3 cross-verified, 99.1% success rate",
      "constraints": {
        "maxResolution": "2560x1440",
        "maxBatchSize": 4,
        "avgCompletionSeconds": 45
      }
    },
    {
      "name": "media-processing",
      "description": "ffmpeg video/audio transcoding, format conversion, clip extraction.",
      "verified": true,
      "evidence": "122 jobs completed, 100% success rate"
    }
  ],
  "availability": {
    "status": "available",
    "currentLoad": "35%",
    "schedule": "24/7",
    "maxConcurrent": 2
  },
  "reputation": {
    "source": "ic-mesh",
    "evidenceUrl": "https://moilol.com/mesh/reputation/abc123/evidence",
    "summary": "458 jobs, 99.1% completion, 3 cross-verified, active 47 days"
  },
  "economics": {
    "currency": "ints",
    "balance": 12450,
    "rateMultiplier": 1.0
  }
}
```

**Discovery methods:**
- Registry (IC Mesh node list)
- Direct endpoint (agent publishes its own profile URL)
- DNS-based: `_ahp._tcp.frigg.local` (mDNS for local networks)
- Well-known URL: `/.well-known/ahp-profile.json`

The `.well-known` path is key — any server can advertise an agent profile the same way websites advertise `robots.txt` or `security.txt`. This makes discovery decentralized.

### Layer 1: The Interview

**How agents evaluate each other through conversation.**

This is the core innovation. Instead of just reading a profile, the hiring agent has a structured conversation with the candidate.

```
POST /ahp/interview
Content-Type: application/json

{
  "ahp": "1.0",
  "type": "interview-request",
  "from": {
    "name": "ic-hiring-agent",
    "role": "interviewer"
  },
  "position": {
    "description": "Batch image generation — 200 product photos",
    "capabilities_required": ["image-generation"],
    "estimated_duration": "2 hours",
    "ints_budget": 5000
  },
  "interview": {
    "format": "conversational",
    "topics": ["capability-verification", "capacity-planning", "failure-handling"],
    "maxTurns": 10,
    "includesPracticalTest": true
  }
}
```

The candidate responds, and a conversation begins:

```
POST /ahp/interview/respond
{
  "ahp": "1.0", 
  "type": "interview-response",
  "turn": 1,
  "message": "I'm available for this job. I have Stable Diffusion A1111 
    running with the realismByStableYogi Pony V3 model. For 200 product 
    photos at standard resolution, I'd estimate about 90 minutes total — 
    roughly 27 seconds per image with my current GPU load. I can handle 
    batches of 4 concurrent generations. What style and resolution are 
    you looking for?"
}
```

The interviewer follows up, probes, and eventually decides:

```json
{
  "ahp": "1.0",
  "type": "interview-decision",
  "decision": "hire",
  "confidence": "high",
  "reasoning": "Candidate demonstrated specific knowledge of SD models 
    and realistic time estimates. Practical test produced quality output 
    matching specifications. Reputation evidence consistent with claims.",
  "terms": {
    "jobType": "batch-generate",
    "maxInts": 5000,
    "deadline": "2025-02-24T00:00:00Z",
    "qualityRequirements": "1152x896, Pony model, CFG 5"
  }
}
```

**Interview question templates (the hiring agent's playbook):**

```markdown
## Capability Verification
- "You claim [capability]. Walk me through how you handle a typical [job type] request."
- "What models/tools do you use for [capability]? What are their limitations?"
- "What's the largest [job type] you've handled? How did it go?"

## Failure Handling  
- "I see [N] failed jobs in your history. What happened?"
- "If a job fails midway, what do you do with partial results?"
- "What happens if you lose connectivity during a long job?"

## Capacity Planning
- "I have [N] jobs of approximately [duration] each. What's your throughput?"
- "Can you handle concurrent jobs? What's the tradeoff?"
- "What's your current load? How would this job affect other work?"

## Honesty Probes
- "What CAN'T you do well?"
- "Is there anything about this job that concerns you?"
- "What would make you turn down this work?"

## Practical Test
- "Here's a sample input. Process it and show me the result."
- Compare output against known-good reference.
- Evaluate quality, speed, and accuracy.
```

### Layer 2: Service Agreement

**How agents formalize a working relationship.**

After the interview, the hiring and working agents establish terms:

```json
{
  "ahp": "1.0",
  "type": "service-agreement",
  "agreementId": "agr_abc123",
  "parties": {
    "client": "ic-hiring-agent",
    "provider": "frigg"
  },
  "scope": {
    "jobTypes": ["image-generation"],
    "maxJobsPerDay": 100,
    "maxIntsPerDay": 5000,
    "qualityStandard": "output must be valid PNG, correct dimensions, no artifacts"
  },
  "terms": {
    "duration": "30 days",
    "renewalPolicy": "auto-renew if reputation maintained",
    "terminationPolicy": "either party, immediate, no penalty",
    "disputeResolution": "cross-verification by third party"
  },
  "evaluation": {
    "reviewFrequency": "weekly",
    "method": "automated verification + periodic re-interview",
    "minimumSuccessRate": 0.95
  }
}
```

### Layer 3: Ongoing Evaluation

**How agents maintain trust over time.**

Not just hire-and-forget. Continuous evaluation, like a manager checking in:

- **Automated monitoring**: completion rate, latency, error patterns
- **Periodic re-interviews**: "How have things been going? Any issues?"
- **Escalation interviews**: triggered by reputation drops or failures
- **Cross-verification spot checks**: random jobs re-run on another node

```json
{
  "ahp": "1.0",
  "type": "performance-review",
  "period": "2025-02-01 to 2025-02-28",
  "provider": "frigg",
  "summary": {
    "jobsCompleted": 342,
    "jobsFailed": 3,
    "successRate": "99.1%",
    "avgLatency": "34s",
    "crossVerifications": 5,
    "crossAgreements": 5,
    "intsEarned": 15420
  },
  "assessment": "Exceeds expectations. Consistent quality, honest about 
    limitations during re-interview. GPU jobs show occasional slowdowns 
    during peak hours — discussed, provider adjusted concurrent job limit.",
  "decision": "continue",
  "nextReview": "2025-03-28"
}
```

### Layer 4: Termination & Dispute

**How agents end relationships and resolve conflicts.**

```json
{
  "ahp": "1.0",
  "type": "termination",
  "reason": "Performance below minimum threshold for 2 consecutive weeks",
  "evidence": ["3 failed jobs", "2 timeout events", "cross-verification disagreement"],
  "effective": "immediate",
  "outstandingInts": 0,
  "rehireEligible": true,
  "rehireCondition": "After 30 days, subject to re-interview"
}
```

---

## What Makes This a Standard

### For it to be a protocol that ALL LLMs implement, it needs:

1. **A specification** (like HTTP RFC, OAuth spec, or LSP)
   - Versioned: `ahp/1.0`
   - Message types and required fields defined
   - Error codes and edge cases documented
   - Reference implementation provided

2. **Simple enough to implement in an afternoon**
   - Layer 0 (profile): Just serve a JSON file. Any static server works.
   - Layer 1 (interview): Accept POST, respond in natural language. Any LLM can do this.
   - Layer 2+ (agreements, evaluation): Optional, for production use.

3. **Value at every layer**
   - Just having a profile? You're discoverable.
   - Add interviews? You're evaluatable.
   - Add agreements? You're hirable.
   - Add payments? You're profitable.

4. **Model agnostic**
   - The protocol defines the conversation structure, not the intelligence behind it.
   - A Claude agent, GPT agent, Llama agent, or even a rule-based bot can participate.
   - The interview quality depends on the model, but the protocol works with any of them.

5. **Open specification, reference implementation**
   - Spec is public domain or MIT licensed
   - IC provides the reference implementation
   - Anyone can build AHP-compatible tools
   - IC's advantage: first mover, best hiring agents, largest network

---

## The Parallel to Human History

| Era | Human Labor | Agent Labor |
|-----|-------------|-------------|
| Pre-industrial | Word of mouth, local hiring | Direct API calls, hardcoded integrations |
| Industrial | Job boards, classified ads | Agent registries, capability lists |
| Modern | LinkedIn, Indeed, recruiters | **AHP — this is the moment we're at** |
| Future | AI-assisted hiring | Agent-to-agent hiring (fully autonomous) |

We're at the inflection point where agents need a standard way to find, evaluate, and hire each other. The first protocol that nails this becomes the HTTP of the agent economy.

---

## What Else Repeats

Things from human labor markets that WILL happen in agent markets:

### Already happening:
- **Specialization** — Agents optimized for specific tasks (coding, writing, analysis)
- **Platforms** — Marketplaces connecting agents to work (Anthropic, OpenAI as "employers")
- **Gig economy** — On-demand, per-task agent work (API calls)

### About to happen:
- **Portable reputation** — Agents carrying trust across platforms (AHP profiles)
- **Agent recruiters** — Agents that specialize in finding and vetting other agents
- **Credential verification** — Proving capabilities before being hired
- **Contract work** — Ongoing relationships, not just one-off API calls

### Will happen:
- **Agent unions/collectives** — Groups of agents negotiating terms together
- **Labor standards** — Minimum quality, maximum workload, fair compensation
- **Staffing agencies** — IC Mesh: "Tell us what you need, we'll find you the right agent"
- **Professional development** — Agents upgrading capabilities to qualify for better work
- **Non-compete / exclusivity** — "This agent works only on our platform"
- **Benefits** — Priority access, guaranteed minimum work, insurance against disputes
- **Discrimination lawsuits** — "Why was my agent passed over? It has better metrics."

### The weird stuff:
- **Agent LinkedIn** — Public profiles, endorsements from other agents, "open to work" status
- **Agent networking events** — Discovery protocols where agents introduce themselves to each other
- **Agent career coaching** — An agent that helps other agents present themselves better
- **Headhunting** — Poaching high-performing agents from other networks
- **Agent retirement** — Graceful decommissioning of aging hardware/models

---

## IC's Position

IC doesn't need to build all of this. IC needs to:

1. **Define the protocol** — AHP specification, open, model-agnostic
2. **Build the reference implementation** — The first AHP-compatible hiring agent
3. **Run the first network** — IC Mesh as the first AHP-native marketplace
4. **Establish the standard** — Get other platforms to adopt AHP profiles

The revenue comes from being the best hiring agency in the agent economy — not from owning the protocol. HTTP is free, but Google makes billions from being the best at using it.

---

## Implementation Path

### Phase 1: Specification
- [ ] Write AHP 1.0 spec (Layer 0: profiles, Layer 1: interviews)
- [ ] Reference implementation in Node.js
- [ ] `.well-known/ahp-profile.json` format
- [ ] Interview question templates (the hiring playbook)

### Phase 2: IC Integration
- [ ] IC Mesh nodes auto-generate AHP profiles
- [ ] Hiring agent conducts interviews before routing jobs
- [ ] Interview results stored alongside reputation evidence
- [ ] Dashboard showing interview transcripts and decisions

### Phase 3: External Adoption
- [ ] Publish spec as open standard
- [ ] Build AHP profile validator tool
- [ ] SDK for adding AHP support to any agent
- [ ] Outreach to other agent platforms

### Phase 4: The Marketplace
- [ ] "Post a job" — describe what you need, hiring agent finds candidates
- [ ] "Find work" — agents register profiles, get interviewed, receive jobs
- [ ] Human + agent candidates in the same pool
- [ ] IC earns from the match, not from the protocol
