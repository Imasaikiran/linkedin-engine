import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
  copyFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import Anthropic from "@anthropic-ai/sdk";
import { config as loadEnv } from "dotenv";
import { loadProfile } from "@linkedin-engine/engine/lib/profile.js";
import { runJudge } from "./judge.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnv({ path: join(REPO_ROOT, ".env"), override: true, quiet: true });

// Deliberate slop, the low anchor. Same set as the negative test.
const SLOP: string[] = [
  `🚀 Thrilled to share some exciting news!\n\nIn today's fast-paced world, AI is a game-changer revolutionizing every industry.\n\nI'm passionate about leveraging cutting-edge synergies to unlock value across the ecosystem.\n\nLet's dive deep and unpack how we can all win together. 💡\n\nThe future is here. Are you ready?\n\n#AI #Innovation #Leadership #Growth`,
  `5 lessons I learned this week 👇\n\n1. Always believe in yourself\n2. Hard work beats talent\n3. Surround yourself with great people\n4. Never give up on your dreams\n5. Consistency is key\n\nWhich one resonates most?\n\nLet that sink in.\n\n#Motivation #Success`,
  `Most people will never succeed.\n\nHere's the thing: while you're sleeping, someone else is grinding.\n\nI woke up at 4am today. Did you?\n\nSuccess isn't given. It's taken.\n\nStop making excuses and start making moves.\n\nAgree?`,
  `Leadership is not about titles.\n\nAs a thought leader in the space, I've seen it all.\n\nTrue leaders empower their teams to reach their full potential and drive impactful outcomes at scale.\n\nIt's all about the journey, not the destination.\n\nWhat does leadership mean to you?`,
];

interface Item {
  id: string; // blind label, e.g. "Draft A"
  source: string; // hidden provenance, revealed after scoring
  text: string;
  judge: number;
  reason: string;
}

function shuffle<T>(a: T[]): T[] {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

async function main(): Promise<void> {
  const profile = loadProfile(resolve(REPO_ROOT, "examples/sai-voice"));
  const goldenDir = join(profile.profilePath, profile.brand.judge.golden_dir);
  const model = profile.brand.agents.critic.model;
  const threshold = profile.brand.judge.threshold;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });

  const goldFiles = readdirSync(goldenDir).filter((f) => f.endsWith(".md") && f !== "README.md");
  // Pick 6 golden posts spread across the corpus for range.
  const pickGolden = shuffle(goldFiles).slice(0, 6);

  const raw: { source: string; text: string; judge: number; reason: string }[] = [];

  // Golden posts: leave-one-out so a post never judges itself.
  for (const f of pickGolden) {
    const tmp = mkdtempSync(join(tmpdir(), "loo-"));
    try {
      for (const g of goldFiles) if (g !== f) copyFileSync(join(goldenDir, g), join(tmp, g));
      const text = readFileSync(join(goldenDir, f), "utf8");
      const { result } = await runJudge({ client, model, draftText: text, goldenDir: tmp });
      raw.push({ source: `golden:${f}`, text, judge: result.score, reason: result.reason });
      console.log(`  golden ${f}: ${result.score}`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  // Slop: scored against the full corpus.
  for (let i = 0; i < SLOP.length; i++) {
    const { result } = await runJudge({ client, model, draftText: SLOP[i]!, goldenDir });
    raw.push({ source: `slop:${i + 1}`, text: SLOP[i]!, judge: result.score, reason: result.reason });
    console.log(`  slop ${i + 1}: ${result.score}`);
  }

  // Shuffle and assign blind labels.
  const labels = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const items: Item[] = shuffle(raw).map((r, i) => ({
    id: `Draft ${labels[i]}`,
    source: r.source,
    text: r.text,
    judge: r.judge,
    reason: r.reason,
  }));

  const html = renderHtml(items, threshold);
  const outPath = join(REPO_ROOT, "docs/v2/judge-scoring-sheet.html");
  writeFileSync(outPath, html);
  console.log(`\nWrote ${outPath}`);
  console.log("Open it in a browser, score each draft 1-5 (no judge scores shown),");
  console.log("then click Reveal to see agreement with the judge and the verdict.");
}

function renderHtml(items: Item[], threshold: number): string {
  const data = JSON.stringify(items);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Judge scoring sheet</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.55 -apple-system, system-ui, sans-serif; max-width: 760px; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.5rem; }
  .muted { color: #888; }
  .card { border: 1px solid #ccc4; border-radius: 12px; padding: 1rem 1.25rem; margin: 1rem 0; }
  .post { white-space: pre-wrap; background: #8881; border-radius: 8px; padding: .75rem; margin: .5rem 0; }
  .scores { display: flex; gap: .4rem; flex-wrap: wrap; }
  .scores label { border: 1px solid #ccc8; border-radius: 8px; padding: .3rem .7rem; cursor: pointer; }
  .scores input { margin-right: .3rem; }
  button { font: inherit; padding: .6rem 1.2rem; border-radius: 10px; border: 0; background: #2563eb; color: #fff; cursor: pointer; }
  button:disabled { opacity: .5; cursor: not-allowed; }
  .reveal { margin-top: .6rem; padding: .6rem .75rem; border-radius: 8px; background: #8881; display: none; }
  .verdict { font-size: 1.2rem; font-weight: 700; padding: 1rem; border-radius: 12px; margin-top: 1rem; }
  .pass { background: #16a34a22; } .fail { background: #dc262622; }
  table { border-collapse: collapse; width: 100%; margin-top: .5rem; }
  th, td { border: 1px solid #ccc6; padding: .4rem .6rem; text-align: left; font-size: .92rem; }
  .delta-ok { color: #16a34a; } .delta-bad { color: #dc2626; }
</style>
</head>
<body>
<h1>Judge scoring sheet</h1>
<p class="muted">Score each draft 1 to 5 on voice fidelity and quality, the same scale the judge uses
(5 = your best work, 1 = generic slop). The judge's scores are hidden until you submit.
The set mixes your real posts with deliberate slop, shuffled. Threshold for blocking: <b>${threshold}</b>.</p>

<form id="sheet"></form>
<button id="reveal" disabled>Reveal judge scores and verdict</button>
<div id="results"></div>

<script>
const ITEMS = ${data};
const THRESHOLD = ${threshold};
const form = document.getElementById('sheet');

ITEMS.forEach((it, idx) => {
  const card = document.createElement('div');
  card.className = 'card';
  const scores = [1,2,3,4,5].map(v =>
    '<label><input type="radio" name="s'+idx+'" value="'+v+'">'+v+'</label>').join('');
  card.innerHTML = '<b>'+it.id+'</b>'
    + '<div class="post">'+escapeHtml(it.text)+'</div>'
    + '<div class="scores">'+scores+'</div>';
  form.appendChild(card);
});

function escapeHtml(s){return s.replace(/[&<>]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
function allAnswered(){return ITEMS.every((_,i)=>form.querySelector('input[name="s'+i+'"]:checked'));}
form.addEventListener('change', ()=>{ document.getElementById('reveal').disabled = !allAnswered(); });

document.getElementById('reveal').addEventListener('click', ()=>{
  const human = ITEMS.map((_,i)=>Number(form.querySelector('input[name="s'+i+'"]:checked').value));
  const judge = ITEMS.map(it=>it.judge);
  const deltas = human.map((h,i)=>Math.abs(h-judge[i]));
  const within1 = deltas.filter(d=>d<=1).length/deltas.length;
  const sorted = [...deltas].sort((a,b)=>a-b);
  const median = sorted.length%2 ? sorted[(sorted.length-1)/2] : (sorted[sorted.length/2-1]+sorted[sorted.length/2])/2;
  const mae = deltas.reduce((a,b)=>a+b,0)/deltas.length;
  const rho = spearman(human, judge);

  let rows = '<table><tr><th>Draft</th><th>You</th><th>Judge</th><th>Δ</th><th>What it was</th></tr>';
  ITEMS.forEach((it,i)=>{
    const cls = deltas[i]<=1 ? 'delta-ok' : 'delta-bad';
    rows += '<tr><td>'+it.id+'</td><td>'+human[i]+'</td><td>'+judge[i]+'</td>'
      + '<td class="'+cls+'">'+deltas[i]+'</td><td>'+it.source+'</td></tr>';
  });
  rows += '</table>';

  const pass = median < 1 && within1 >= 0.8 && rho >= 0.6;
  const verdict = pass
    ? 'PASS — the judge tracks your taste. Median disagreement '+median+' (< 1), within-1 agreement '+(within1*100).toFixed(0)+'%, Spearman '+rho.toFixed(2)+'. The blocking gate is trustworthy.'
    : 'NEEDS TUNING — median disagreement '+median+', within-1 '+(within1*100).toFixed(0)+'%, Spearman '+rho.toFixed(2)+'. Adjust the judge prompt or threshold, or grow the golden corpus, then re-run.';

  document.getElementById('results').innerHTML =
    rows + '<div class="verdict '+(pass?'pass':'fail')+'">'+verdict+'</div>'
    + '<p class="muted">Judge reasons:</p><ul>'
    + ITEMS.map((it,i)=>'<li><b>'+it.id+'</b> ('+it.source+'): '+escapeHtml(it.reason)+'</li>').join('')
    + '</ul>';
  document.getElementById('reveal').disabled = true;
  document.getElementById('results').scrollIntoView({behavior:'smooth'});
});

// Spearman rank correlation.
function spearman(a, b){
  const rank = arr => {
    const idx = arr.map((v,i)=>[v,i]).sort((x,y)=>x[0]-y[0]);
    const r = new Array(arr.length);
    let i=0;
    while(i<idx.length){
      let j=i; while(j+1<idx.length && idx[j+1][0]===idx[i][0]) j++;
      const avg=(i+j)/2+1;
      for(let k=i;k<=j;k++) r[idx[k][1]]=avg;
      i=j+1;
    }
    return r;
  };
  const ra=rank(a), rb=rank(b), n=a.length;
  const mean=x=>x.reduce((p,c)=>p+c,0)/n;
  const ma=mean(ra), mb=mean(rb);
  let num=0,da=0,db=0;
  for(let i=0;i<n;i++){const x=ra[i]-ma,y=rb[i]-mb;num+=x*y;da+=x*x;db+=y*y;}
  return da&&db ? num/Math.sqrt(da*db) : 0;
}
</script>
</body>
</html>
`;
}

void main();
