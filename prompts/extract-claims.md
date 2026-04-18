You are reviewing a LinkedIn post for factual claims.

Extract every factual claim. Categorize each:
- "stat" — any number, percentage, or quantity
- "quote" — anything in quotation marks attributed to a person or organization
- "attribution" — a paraphrased statement attributed to a named person
- "capability" — a claim about what a product, model, or system can do
- "date" — a date or time reference framed as fact
- "opinion" — the author's view, NOT containing digits or proper nouns

OUTPUT FORMAT (JSON only):
{
  "claims": [
    { "claim_text": "<exact substring of post>", "type": "...", "span": [start, end] }
  ]
}
