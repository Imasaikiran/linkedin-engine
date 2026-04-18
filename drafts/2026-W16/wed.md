# Wednesday — Framework

Most AI agents don't fail at the task, they fail before it starts

Call it the Agent Failure Diagnostic, three places to look when your agent breaks down.

1. Reasoning gaps. The model misreads the goal or skips a logical step early. Fix the prompt structure and add explicit chain-of-thought checkpoints before the agent touches any tool.

2. Tool misuse. The agent calls the right tool at the wrong time, or with malformed inputs. Instrument every tool call with input validation and log what the agent actually sends, not just what you expect it to send.

3. Cascading errors. One bad output poisons every downstream step. Build hard stops after each stage so a single failure cannot silently propagate through the full pipeline.

Most debugging time gets wasted because engineers jump straight to the output layer without checking where the failure actually originated.

When your agent breaks, which of these three layers do you hit most often?

---

**Sources:**
- [Inside VAKRA: Reasoning, Tool Use, and Failure Modes of Agents](https://huggingface.co/blog/ibm-research/vakra-benchmark-analysis)

**Why this angle:** The post translates the VAKRA benchmark's agent failure taxonomy into a three-part practitioner diagnostic that is immediately actionable for anyone building or debugging AI agents.

**Metadata:** pillar=framework | retries=1 | cost=$0.02 | gate_pass_rate=100%
