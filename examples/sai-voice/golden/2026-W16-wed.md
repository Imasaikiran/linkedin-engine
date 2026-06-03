# Wednesday — Framework

Most AI agents don't fail loudly. They fail quietly, and you ship them anyway

I call it the 3-Layer Agent Diagnostic. Run it before any agent goes to production.

1. Reasoning gaps. The agent reaches a wrong conclusion not because it lacks data, but because its chain of thought breaks mid-task. Trace the reasoning steps, not just the final output.

2. Tool misuse. The agent calls the right tool at the wrong moment, or passes malformed inputs it never validates. Log every tool call with its inputs and the downstream result.

3. Context collapse. Long conversations or multi-step tasks cause the agent to lose track of earlier constraints. Test explicitly at the edges of your context window, not just at average session length.

Diagnosing the layer tells you exactly where to intervene, not just that something went wrong.

When you debug your agents, which of these three layers trips you up most often?

---

**Sources:**
- [Inside VAKRA: Reasoning, Tool Use, and Failure Modes of Agents](https://huggingface.co/blog/ibm-research/vakra-benchmark-analysis)

**Why this angle:** The 3-layer structure maps reasoning gaps, tool misuse, and context collapse into a concrete audit checklist that practitioners can apply immediately to their own agent pipelines before shipping.

**Metadata:** pillar=framework | retries=2 | cost=$0.03 | gate_pass_rate=100%
