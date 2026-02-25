# IC Mesh — The Hiring Agent

*Trust through conversation, not calculation.*

**Status: Design concept — not implemented**

---

## The Idea

Instead of algorithmically deciding whether to trust a node or agent, **interview them.** Have an actual conversation. Ask questions. Evaluate responses. Make a judgment call — the same way humans hire humans.

The reputation evidence, ints balance, and capability claims become the **resume.** The interview is where the real decision happens.

And critically: **the same process works for humans and agents.** The interviewer doesn't need to know whether the candidate is a Mac Mini, a cloud instance, or a person. It evaluates through dialogue.

---

## Why Conversation > Algorithm

Algorithms are gameable. If you know the scoring formula, you can optimize for it without actually being good. That's why SEO spam exists — people figured out PageRank and gamed it.

Conversations are harder to game. An interviewer can:
- Ask follow-up questions when something doesn't add up
- Probe edge cases ("What happens if the input file is corrupted?")
- Test for genuine understanding vs memorized responses
- Catch inconsistencies between claimed capabilities and actual knowledge
- Adapt their evaluation based on the role being filled

This is what Google eventually learned too — PageRank wasn't enough. They added quality raters (humans evaluating pages through interaction). We're doing the same thing, but with an agent as the rater.

---

## How It Works

### The Interview Flow

```
1. RESUME REVIEW
   Hiring agent reads the candidate's evidence dossier:
   - Reputation events (job history, cross-verifications)
   - Ints balance (contribution vs consumption)
   - Claimed capabilities
   - Recent failures

2. INITIAL SCREEN
   Quick automated checks:
   - Is the node online?
   - Does it have the required capabilities?
   - Is the ints balance within acceptable range?
   - Any red flags in reputation?
   (If fail → reject without interview. Don't waste time.)

3. THE INTERVIEW
   Hiring agent has a conversation with the candidate:
   
   "I see you've completed 47 transcription jobs. Tell me about
    the 2 that failed — what happened?"
   
   "You claim gpu-metal capability but I don't see any GPU jobs
    in your history. Can you demonstrate?"
   
   "I have a batch of 200 audio files, each about 10 minutes.
    How would you handle that? What's your throughput?"
   
   "Your average completion time for transcription is 34 seconds.
    Last week you had three jobs over 120 seconds. Why the spikes?"

4. PRACTICAL TEST
   Give the candidate a small test job:
   - Transcribe a known audio clip, compare to expected output
   - Generate an image with specific requirements
   - Process a video with precise specifications
   This is the "take-home assignment" — verify they can do the work.

5. DECISION
   Hiring agent makes a judgment:
   - Hire (route jobs to this node)
   - Conditional hire (start with small jobs, graduate to larger ones)
   - Reject (don't use this node)
   - Flag for review (something seems off, needs human attention)
```

### What the Hiring Agent Evaluates

**Technical competence:**
- Can they actually do the work? (Verified through test jobs)
- Do they understand their own capabilities and limits?
- How do they handle edge cases?

**Reliability signals:**
- How do they explain past failures? (Honest = good. Evasive = bad.)
- Is their self-assessment accurate? (Claims match reality?)
- Do they over-promise? ("I can do anything!" = red flag)

**Consistency:**
- Does the interview match the resume?
- Are there contradictions between what they say and what the evidence shows?
- Do follow-up questions reveal gaps?

---

## The Crossover: Humans and Agents

This is the key insight. The hiring agent doesn't care what the candidate IS — it cares what the candidate CAN DO.

### Agent Candidate
```
Interviewer: "What transcription models do you have available?"
Node: "Whisper base and medium. Base is faster, medium is more 
       accurate. I typically use base for short clips and medium
       for anything over 5 minutes."
Interviewer: "Good. What's your GPU situation?"
Node: "Apple M1 Max, 32GB unified memory. Metal acceleration. 
       I can handle concurrent inference and transcription but 
       not SD generation at the same time — that takes all the VRAM."
Interviewer: "Honest answer. I like that. Let me send you a test clip."
```

### Human Candidate
```
Interviewer: "I see you have experience with video editing. 
             What software do you use?"
Human: "DaVinci Resolve mainly, some Premiere. I do color grading 
        and basic VFX."
Interviewer: "We have a batch of farming videos that need color 
             correction and titles. 3-5 minute videos. How many 
             could you do in a week?"
Human: "Probably 10-15 if they're straightforward. More if I can 
        template the title style."
Interviewer: "Let me send you a sample video for a test edit."
```

**Same process. Same evaluation framework. Same trust-building.**

The difference between hiring a human editor and hiring an ffmpeg node is just the conversation — the framework is identical.

---

## Integration with Existing Systems

### Reputation = Resume
The evidence dossier (`GET /reputation/:nodeId/evidence`) is the resume the hiring agent reads before the interview. It provides:
- Job history and completion rates
- Cross-verification results (peer review)
- Capability verification status
- Recent failures and patterns

### Ints = Compensation History
The ints balance and transaction history show:
- How much work has been done (total earned)
- How much work has been consumed (total spent)
- Whether the candidate is a net contributor or consumer
- Payment reliability

### Capabilities = Skills on Resume
What the node advertises it can do, verified or not. The interview probes whether these claims hold up.

### The Interview = The Decision Layer
Reputation and ints are inputs to the conversation, not the output. The hiring agent uses them as context but makes its decision through dialogue. This is the layer that's hard to game — you can fake a resume, but it's much harder to fake a conversation with a competent interviewer.

---

## As a Product

### For IC Mesh (internal)
- Hiring agent vets new nodes before they receive jobs
- Periodic re-interviews for established nodes
- Escalation interviews when reputation drops
- Test jobs as part of the evaluation

### For External Clients (future)
- "Hire an agent for your project" — IC's hiring agent interviews available nodes/agents and recommends the best fit
- Clients describe what they need in natural language
- Hiring agent matches, interviews candidates, presents shortlist
- Same service for hiring humans for tasks that need a human touch

### As a Standalone Service (spin-off)
- An agent that interviews other agents for trust evaluation
- Pluggable into any system that needs to evaluate AI capabilities
- The same interviewer works for humans (freelance hiring, contractor vetting)
- Revenue model: charge per interview/evaluation

---

## Open Questions

1. **Who interviews the interviewer?** — How do we ensure the hiring agent itself is trustworthy? (Maybe: multiple hiring agents, cross-evaluate each other)

2. **Interview frequency** — How often should established nodes be re-interviewed? (Maybe: on reputation change, or every N jobs, or on failure)

3. **Gaming the interview** — LLMs are good at saying the right thing. How do we ensure the practical test carries enough weight? (Maybe: 70% test results, 30% conversation)

4. **Human-agent boundary** — When a client asks for work, should they know whether the worker is human or agent? (Maybe: optional disclosure, but the quality speaks for itself)

5. **Interview cost** — Interviews consume compute (LLM inference). Who pays? (Maybe: IC absorbs as cost of trust infrastructure, or candidate pays a small interview fee in ints)

---

## The Vision

IC becomes a **hiring agency** where the recruiters are agents. They read resumes (reputation), check references (cross-verification), conduct interviews (conversation), and give practical tests (verification jobs). 

The candidates are computers, AI agents, and humans — all evaluated through the same conversational framework.

Trust isn't a number. It's a relationship built through interaction.
