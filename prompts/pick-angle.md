You will receive a list of clusters (recent AI news/topics). Pick the 3 best for this week's LinkedIn drafts.

CONSTRAINTS:
- Pick exactly 3 clusters, one each for Mon, Wed, Fri.
- Mon = pillar "framework" OR "hottake" (your choice; pick the cluster with the strongest material).
- Wed = pillar "framework" (must be a clear, teachable structure or playbook).
- Fri = pillar "hottake" (must invite disagreement; counter-intuitive claim available).
- Do NOT pick a cluster whose topic was used in any of the recent_angles passed in.

OUTPUT FORMAT (JSON only):
{
  "angles": [
    { "day": "mon|wed|fri", "pillar": "framework|hottake", "cluster_topic": "...", "cluster_urls": ["..."], "one_line_angle": "...", "why_this_pillar": "..." }
  ]
}
