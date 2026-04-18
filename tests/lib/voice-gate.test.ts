import { describe, it, expect } from 'vitest';
import { runVoiceGate } from '../../src/lib/gate.js';

describe('runVoiceGate', () => {
  it('passes a clean post', () => {
    const post = `What if every model release felt like a product launch

Most teams treat releases as engineering milestones, not product moments.
Three reasons that costs you reach.
First, no narrative around what the model actually changes.

Second, no positioning for the audience who will use the work day to day.
Third, no question to anchor the room and invite real conversation back.

Fix those three gaps and your model lands twice as hard.
Engineers ship code. Product thinkers land outcomes.
The difference comes down to narrative, positioning, and a clear call.

Teams that nail the story get ten times the organic reach.
Teams that skip the story get a changelog post and silence.
One week later nobody remembers what you released or why it mattered.

What does your team do differently on launch day?`;
    const r = runVoiceGate(post, { pillar: 'hottake' });
    expect(r.pass).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it('fails on em dash', () => {
    const post = `Hook line works fine here today
Body — with an em dash kills it.
What now?`;
    const r = runVoiceGate(post, { pillar: 'hottake' });
    expect(r.pass).toBe(false);
    expect(r.failures.join(' ')).toMatch(/em.?dash/i);
  });

  it('fails on banned phrase', () => {
    const post = `Hook line works fine here today
I recently shipped something cool.
What now?`;
    const r = runVoiceGate(post, { pillar: 'hottake' });
    expect(r.pass).toBe(false);
    expect(r.failures.join(' ')).toMatch(/I recently/i);
  });

  it('fails when last line is not a question', () => {
    const post = `Hook line works fine here today
A body sentence.
End statement.`;
    const r = runVoiceGate(post, { pillar: 'hottake' });
    expect(r.pass).toBe(false);
    expect(r.failures.join(' ')).toMatch(/question/i);
  });

  it('fails on word count out of range for pillar', () => {
    const post = `Hook line works fine here today
short.
?`;
    const r = runVoiceGate(post, { pillar: 'framework' });
    expect(r.pass).toBe(false);
    expect(r.failures.join(' ')).toMatch(/word count/i);
  });
});
