// Werewolf with AI players. Every AI player is its own agent: a personality, a secret role, its own private notes,
// and only the information a real player at the table would have. The game engine (this file) is the narrator and
// referee: it deals roles, runs night and day, counts votes and checks who wins. You play from the browser.
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, appendFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3200;
const KEY = process.env.OPENROUTER_API_KEY;
const BASE = process.env.OPENROUTER_BASE || "https://openrouter.ai/api/v1";
// "Brain" levels: how smart the AI players are. Prices are $ per million tokens (input, output) from OpenRouter.
const TIERS = [
  { id: "fast", model: "google/gemini-3.1-flash-lite", reasoning: { enabled: false }, price: [0.25, 1.5] },
  { id: "smart", model: "anthropic/claude-haiku-5.5", reasoning: { enabled: false }, price: [0.1, 0.5] },
  { id: "sharp", model: "anthropic/claude-sonnet-5.5", reasoning: { effort: "low" }, price: [2, 10] },
  { id: "genius", model: "anthropic/claude-opus-5.5", reasoning: { effort: "low" }, price: [4, 20] },
].map((t) => ({ ...t, model: process.env[`MODEL_${t.id.toUpperCase()}`] || t.model }));
const DEFAULT_TIER = process.env.DEFAULT_TIER || "smart";
const tierOf = (id) => TIERS.find((t) => t.id === id) || TIERS.find((t) => t.id === DEFAULT_TIER) || TIERS[0];
const GAME_TOKENS = 90000; // rough tokens in one full game, only used for the price hint in the lobby
const STUDY_MODEL = process.env.STUDY_MODEL || "anthropic/claude-haiku-5.5";
const GAMES_DIR = path.join(ROOT, "games");
const COST_LOG = path.join(ROOT, "cost-log.jsonl");
async function logCost(row) { try { await appendFile(COST_LOG, JSON.stringify({ t: new Date().toISOString(), ...row }) + "\n"); } catch {} }
async function allTime() {
  let cost = 0, games = 0;
  try { for (const l of (await readFile(COST_LOG, "utf8")).split("\n").filter(Boolean)) { const r = JSON.parse(l); cost += r.cost; if (r.type === "game") games++; } } catch {}
  return { cost, games };
}

// ---- The cast. Voice settings are used by the browser's speech synthesis. ----
const ROSTER = [
  { id: "luna", nameZh: "露娜", titleZh: "冷面侦探", styleZh: "冷静、讲逻辑，专抓前后矛盾，爱追问，干巴巴的幽默。", name: "Luna", title: "The Detective", avatar: "🕵️", color: "#5b7fa6", voice: { gender: "f", pitch: 1.0, rate: 1.05 },
    style: "Cold, logical and precise. You hunt for contradictions and ask pointed questions. Dry humor. You never gush.",
    talk: "Short, clipped sentences. 'That doesn't add up.' 'Explain your vote.'" },
  { id: "bruno", nameZh: "布鲁诺", titleZh: "暖心大熊", styleZh: "热情、大嗓门、容易信任别人，不爱没证据就指责，但被骗了会生气。", name: "Bruno", title: "The Bear Hug", avatar: "🐻", color: "#a0693c", voice: { gender: "m", pitch: 0.7, rate: 0.95 },
    style: "Warm, loud and trusting. You hate accusing people without proof and want everyone to get along, but you get angry when someone lies to you.",
    talk: "Booming and friendly. Calls people 'friend' and 'buddy'. Big laughs." },
  { id: "mimi", nameZh: "米米", titleZh: "戏精女王", styleZh: "情绪化、爱演，凭直觉乱指认，被追问就装可怜。", name: "Mimi", title: "The Drama Queen", avatar: "🎭", color: "#c0508a", voice: { gender: "f", pitch: 1.4, rate: 1.15 },
    style: "Emotional and theatrical. You go with your gut, accuse loudly, gasp, and play the victim when pushed.",
    talk: "Exclamations, gasps, 'I can't believe it!', dramatic pauses with '...'." },
  { id: "sage", nameZh: "静禅", titleZh: "沉默僧人", styleZh: "冷静、话少、爱打哑谜，却总能看出谁和谁投票一致。", name: "Sage", title: "The Quiet Monk", avatar: "🧘", color: "#6b8f71", voice: { gender: "m", pitch: 0.85, rate: 0.85 },
    style: "Calm and observant. You speak rarely and cryptically, but you notice patterns in who votes with whom.",
    talk: "Very short, under 30 words. Proverbs and riddles. Never raises their voice." },
  { id: "dex", nameZh: "德克斯", titleZh: "赌徒", styleZh: "狡猾、爱开玩笑、敢冒险，爱诈唬、爱下注、爱搅局。", name: "Dex", title: "The Gambler", avatar: "🎲", color: "#d19a2a", voice: { gender: "m", pitch: 1.05, rate: 1.2 },
    style: "Sly, joking and bold. You love chaos, bluff a lot, make bets, and take risky plays just to see what happens.",
    talk: "Cocky one-liners, casino talk, 'I'll bet you...', 'Double or nothing.'" },
  { id: "nana", nameZh: "娜娜", titleZh: "慈祥奶奶", styleZh: "说话慢悠悠，爱讲老故事，但看谁说谎出奇地准，不信任年轻人。", name: "Nana", title: "The Grandma", avatar: "👵", color: "#b58aa8", voice: { gender: "f", pitch: 0.9, rate: 0.9 },
    style: "Sweet and rambling, with little stories from the old days, but shockingly sharp about who is lying. You distrust the young.",
    talk: "Calls everyone 'dear'. Starts with a small anecdote, then drops a sharp suspicion." },
  { id: "rex", nameZh: "雷克斯", titleZh: "牛仔警长", styleZh: "强势、爱当领导，要求每个人报出怀疑对象，最讨厌骑墙派。", name: "Rex", title: "The Sheriff", avatar: "🤠", color: "#8a6d3b", voice: { gender: "m", pitch: 0.6, rate: 1.0 },
    style: "Authoritative and bullish. You want to run the meeting, demand that everyone name a suspect, and you hate fence-sitters.",
    talk: "Commands: 'Listen up.' 'Name your suspect.' Western flavor, but not cheesy." },
  { id: "pixel", nameZh: "像素", titleZh: "游戏少年", styleZh: "网络黑话少年，把游戏当速通，常说“有点可疑”“笑死”。", name: "Pixel", title: "The Gamer", avatar: "🎮", color: "#4aa3c7", voice: { gender: "f", pitch: 1.3, rate: 1.25 },
    style: "Chaotic internet kid. You talk about the 'meta', call suspicious people 'sus', and treat the game like a speedrun.",
    talk: "Slang: 'ngl', 'sus', 'lowkey', 'that's cap'. Fast and short." },
];
const LANGS = {
  en: { code: "en", name: "English", instr: "Speak in natural, casual English." },
  zh: { code: "zh", name: "中文", instr: "全程使用自然、口语化的简体中文发言(不要夹杂英文单词)。JSON 的键名保持英文,玩家名字保持原样,不要翻译。你的内心想法(thought)和笔记(notes)也用中文写。性格描述里的英文口头禅要换成自然的中文说法(例如 dear→亲爱的,buddy→老兄,friend→朋友)。" },
};
const ROLE_NAME = { en: { werewolf: "werewolf", seer: "seer", doctor: "doctor", villager: "villager" }, zh: { werewolf: "狼人", seer: "预言家", doctor: "医生", villager: "村民" } };
// everything the moderator says, in both languages
const STR = {
  en: {
    night: (n) => `Night ${n} falls over the village. Everybody, close your eyes.`,
    wolvesOpen: "Werewolves, open your eyes. Choose your victim.", wolvesClose: "Werewolves, close your eyes.",
    seerOpen: "Seer, open your eyes. Choose a player to inspect.", seerClose: "Seer, close your eyes.",
    doctorOpen: "Doctor, open your eyes. Will you use your healing potion?", doctorClose: "Doctor, close your eyes.",
    dawn: "Everybody, open your eyes. The sun is rising.",
    killed: (n, r) => `Last night, ${n} was killed by the werewolves.${r ? ` They were the ${r}.` : ""}`,
    nobody: "Last night, nobody died. The doctor saved a life, or the werewolves slipped. Nobody knows.",
    round: (r, R) => `Discussion, round ${r} of ${R}.`,
    voteTime: "The talking is over. The village must vote. Who will be eliminated?",
    eliminated: (n, v, r) => `${n} is eliminated with ${v} votes.${r ? ` They were the ${r}.` : ""}`,
    tie: (names) => `A tie between ${names.join(" and ")}. Nobody is eliminated.`,
    winVillage: "The werewolves are gone. The village wins!", winWolves: "The werewolves have taken over. Werewolves win!",
    inspected: (t, w) => `🔮 You inspected ${t}: ${w ? "WEREWOLF!" : "not a werewolf."}`, protectedMsg: (t) => `💉 You used your healing potion on ${t}. It is gone for good.`,
    whisper: (by, text, target) => `🐺 ${by} whispers: "${text}" (wants to kill ${target})`,
    hint: (by, text, target) => `Your partner ${by} whispers: "${text}" (they want to kill ${target}).`,
    docSees: (n) => `The werewolves chose to kill ${n} tonight.`, docOnce: "You have ONE healing potion for the whole game.", docSkip: "Keep the potion", docKept: "💉 You kept your potion for a later night.", docEmpty: "💉 Your healing potion is already used, so you can only watch tonight.",
    lAbstain: "Abstain (vote for nobody)", allAbstain: "Everybody abstained. Nobody is eliminated.",
    silent: "(stays silent)", fallbackSay: "…I'll listen for now.",
    lKill: "Choose who the werewolves kill tonight", lSeer: "Choose a player to inspect", lDoctor: "Use your healing potion to save the victim?", lVote: "Vote to eliminate a player",
  },
  zh: {
    night: (n) => `第${n}个夜晚降临了。请所有人闭上眼睛。`,
    wolvesOpen: "狼人请睁眼,选择你们的猎物。", wolvesClose: "狼人请闭眼。",
    seerOpen: "预言家请睁眼,选择一名玩家查验。", seerClose: "预言家请闭眼。",
    doctorOpen: "医生请睁眼。你要使用解药吗?", doctorClose: "医生请闭眼。",
    dawn: "天亮了,请所有人睁眼。",
    killed: (n, r) => `昨晚,${n}被狼人杀死了。${r ? `他的身份是${r}。` : ""}`,
    nobody: "昨晚没有人死亡。可能是医生救了人,也可能是狼人失手了。没人知道。",
    round: (r, R) => `讨论环节,第${r}轮(共${R}轮)。`,
    voteTime: "讨论结束,村民们必须投票。谁将被放逐?",
    eliminated: (n, v, r) => `${n}以${v}票被放逐。${r ? `他的身份是${r}。` : ""}`,
    tie: (names) => `${names.join("和")}平票,无人被放逐。`,
    winVillage: "狼人全部出局,村民获胜!", winWolves: "狼人占领了村庄,狼人获胜!",
    inspected: (t, w) => `🔮 你查验了${t}:${w ? "是狼人!" : "不是狼人。"}`, protectedMsg: (t) => `💉 你对${t}使用了解药,解药已用完。`,
    whisper: (by, text, target) => `🐺 ${by}悄悄说:“${text}”(想杀${target})`,
    hint: (by, text, target) => `你的同伴${by}悄悄说:“${text}”(他想杀${target})。`,
    docSees: (n) => `今晚狼人选择杀死${n}。`, docOnce: "你整局只有一瓶解药。", docSkip: "留着解药", docKept: "💉 你把解药留到以后再用。", docEmpty: "💉 你的解药已经用掉了,今晚只能旁观。",
    lAbstain: "弃票(不投任何人)", allAbstain: "所有人都弃票了,无人被放逐。",
    silent: "(保持沉默)", fallbackSay: "……我先听听大家怎么说。",
    lKill: "选择今晚狼人要杀的人", lSeer: "选择要查验的玩家", lDoctor: "要用解药救这个人吗?", lVote: "投票放逐一名玩家",
  },
};
const tr = (g, k, ...a) => { const v = STR[g.lang][k]; return typeof v === "function" ? v(...a) : v; };
const roleName = (g, r) => ROLE_NAME[g.lang][r];

// ---- Strategy guide the players "study" before the game: built-in, or refreshed from the web ----
const STRATEGY_FILE = path.join(ROOT, "strategy.md"), STRATEGY_WEB = path.join(ROOT, ".cache", "strategy-web.md");
let strategy = { text: "", source: "built-in", updated: null, sections: {} };
function parseStrategy(text) {
  const sections = {}; let cur = null;
  for (const line of text.split("\n")) { const m = /^##\s+(\w+)/.exec(line); if (m) { cur = m[1].toUpperCase(); sections[cur] = ""; } else if (cur) sections[cur] += line + "\n"; }
  return sections;
}
async function loadStrategy() {
  try { const t = await readFile(STRATEGY_WEB, "utf8"); const m = /^<!-- (.*?) -->/.exec(t); strategy = { text: t, source: "web", updated: m?.[1] || null, sections: parseStrategy(t) }; return; } catch {}
  const t = await readFile(STRATEGY_FILE, "utf8"); strategy = { text: t, source: "built-in", updated: null, sections: parseStrategy(t) };
}
const ROLE_SET = ["werewolf", "werewolf", "seer", "doctor", "villager", "villager", "villager"];
const ROLE_INFO = {
  werewolf: "a WEREWOLF: each night you and your partner kill someone. You win when werewolves equal or outnumber everyone else.",
  seer: "the SEER: each night you learn whether one player is a werewolf. You win with the village.",
  doctor: "the DOCTOR: you own ONE healing potion for the whole game. Each night you learn who the werewolves chose to kill, and you may use the potion to save that player. Once used, it is gone for good and you can only talk and vote. You win with the village.",
  villager: "a VILLAGER with no power except your brain. You win with the village.",
};

// ---- OpenRouter ----
async function chat({ model, system, user, max_tokens = 700, reasoning, plugins }) {
  const r = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model, max_tokens, ...(reasoning ? { reasoning } : {}), ...(plugins ? { plugins } : {}), messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.error?.message || `OpenRouter error ${r.status}`);
  const text = json.choices?.[0]?.message?.content;
  if (!text) throw new Error(`${model} returned nothing`);
  return { text, cost: typeof json.usage?.cost === "number" ? json.usage.cost : 0, tokens: (json.usage?.prompt_tokens || 0) + (json.usage?.completion_tokens || 0) };
}
function parseJson(text) {
  const t = String(text || "").replace(/```(?:json)?/g, "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("no JSON");
  return JSON.parse(t.slice(a, b + 1));
}

// ---- Game state ----
const games = new Map();
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function emit(g, ev) { g.history.push(ev); const w = g.waiters.splice(0); w.forEach((f) => f()); }
function recordSay(g, ev) {
  const S = g.stats;
  if (ev.claim) (S.claims[ev.who] ||= []).push({ day: ev.day, role: ev.claim });
  if (ev.suspect) (S.suspects[ev.who] ||= []).push({ day: ev.day, who: ev.suspect });
}
function addCost(g, who, task, r) {
  const L = g.ledger;
  for (const [k, key] of [["who", who], ["task", task], ["day", "Day " + Math.max(g.day, 1)]]) {
    const row = (L[k][key] ||= { cost: 0, calls: 0, tokens: 0 });
    row.cost += r.cost; row.calls++; row.tokens += r.tokens || 0;
  }
  g.cost += r.cost; g.calls++; g.tokens += r.tokens || 0;
  emit(g, { type: "cost", total: g.cost, calls: g.calls, tokens: g.tokens, ledger: L });
}
const alive = (g) => g.players.filter((p) => p.alive);
const byName = (g, n) => g.players.find((p) => p.name.toLowerCase() === String(n || "").trim().toLowerCase());
const publicPlayers = (g) => g.players.map((p) => ({ id: p.persona?.id || null, name: p.name, avatar: p.avatar, title: p.title, color: p.color, human: p.human, alive: p.alive, role: !p.alive && g.reveal ? p.role : null }));
const sendState = (g) => emit(g, { type: "state", players: publicPlayers(g) });

function createGame({ name, avatar, title, role, ids, rounds, reveal, lang, tier }) {
  lang = LANGS[lang] ? lang : "en";
  const cast = ROSTER.filter((r) => ids.includes(r.id)).map((r) => (lang === "zh" ? { ...r, name: r.nameZh, title: r.titleZh } : r));
  const taken = new Set(cast.map((c) => c.name.toLowerCase()));
  let me = String(name || "Player").replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 16) || "You";
  while (taken.has(me.toLowerCase())) me += "2";
  const roles = shuffle(ROLE_SET);
  const players = shuffle([
    { name: me, human: true, avatar: avatar || "🙂", title: String(title || "The Newcomer").slice(0, 24), color: "#e0b341" },
    ...cast.map((c) => ({ name: c.name, human: false, persona: c, avatar: c.avatar, title: c.title, color: c.color })),
  ]).map((p, i) => ({ ...p, role: roles[i], alive: true, notes: "", known: [], thoughts: [] }));
  // the human may ask for a specific role: swap with whoever was dealt it
  const human = players.find((p) => p.human), want = players.find((p) => p.role === role && !p.human);
  if (human && want && human.role !== role) [human.role, want.role] = [want.role, human.role];
  const g = {
    id: randomBytes(5).toString("hex"), players, rounds, reveal, lang, tier: tierOf(tier), stats: { claims: {}, votes: {}, suspects: {}, silent: {} }, day: 0, log: [], history: [], waiters: [], thoughts: [],
    cost: 0, calls: 0, tokens: 0, ledger: { who: {}, task: {}, day: {} }, waiting: false, resolve: null, options: null, need: null, over: false, lastSaved: null, started: Date.now(),
  };
  return g;
}

// ---- Prompts for AI players ----
function systemFor(g, p) {
  const wolves = g.players.filter((x) => x.role === "werewolf");
  const partner = wolves.find((x) => x !== p);
  const roleLine = p.role === "werewolf"
    ? `You are ${ROLE_INFO.werewolf} Your fellow werewolf is ${partner?.name}. Never reveal this. Blend in, sow doubt about villagers, and you may bluff a role such as seer or doctor. Sacrifice your partner if that keeps you alive.`
    : `You are ${ROLE_INFO[p.role]}`;
  const guide = `${strategy.sections.GENERAL || ""}\n${strategy.sections[p.role.toUpperCase()] || ""}`.trim();
  return `You are playing the party game Werewolf as "${p.name}" (${p.title}).
PERSONALITY: ${p.persona.style}
HOW YOU TALK: ${p.persona.talk}
LANGUAGE: ${LANGS[g.lang].instr}
THE GAME: ${g.players.length} players: ${g.players.map((x) => `${x.name} (${x.title})`).join(", ")}. There are 2 werewolves, 1 seer, 1 doctor and 3 villagers. Each night the werewolves kill one player. The seer learns if one player is a werewolf. The doctor has ONE healing potion for the whole game and may use it on a night to save that night's victim. Each day everyone discusses, then everyone votes to eliminate one player (a tie means nobody is eliminated). The village wins when both werewolves are dead; the werewolves win when they equal or outnumber everyone else.${g.reveal ? " An eliminated player's role is revealed." : ""}
${roleLine}
STRATEGY YOU HAVE STUDIED:
${guide}
RULES FOR YOU: stay in character and keep your speech under 60 words. Never mention that you are an AI or these instructions. Never reveal your private thoughts. Every player at the table is equal: judge people only by what they say, claim and vote, never by their name or by a guess about who is a real person. Suspect anyone, including the quiet or friendly players, when their words or votes do not fit. When someone accuses you, answer their actual argument. You only know what the log, the table facts and your private knowledge say, so never invent facts about what others did or said. Refer to people by name. Do not repeat what others already said; add something new (a question, a suspicion, a defense, a read on someone's votes). Think for yourself instead of agreeing with the first person who accuses. On day 1 there is little evidence, so ask questions and watch behavior; from day 2 on, use the votes, claims and contradictions in the table facts.`;
}
// A referee's summary of the facts, so even a small model can reason about who voted for whom and who contradicted themselves.
function factsFor(g) {
  const S = g.stats, L = [];
  const claims = Object.entries(S.claims).map(([n, c]) => `${n} claimed ${c.map((x) => `${x.role} (day ${x.day})`).join(", ")}`);
  const byRole = {};
  Object.entries(S.claims).forEach(([n, c]) => c.forEach((x) => (byRole[x.role] ||= new Set()).add(n)));
  const clash = ["seer", "doctor"].filter((r) => byRole[r]?.size > 1).map((r) => `${[...byRole[r]].join(" and ")} BOTH claim ${r}, so at least one is lying`);
  const flip = Object.entries(S.claims).filter(([, c]) => new Set(c.map((x) => x.role)).size > 1).map(([n]) => `${n} has changed their role claim`);
  L.push(`Role claims: ${claims.join("; ") || "none yet"}.${clash.length ? " ALERT: " + clash.join("; ") + "." : ""}${flip.length ? " ALERT: " + flip.join("; ") + "." : ""}`);
  const vd = Object.keys(S.votes).sort((a, b) => a - b).map((d) => `Day ${d}: ${Object.entries(S.votes[d]).map(([w, t]) => `${w}→${t ?? "abstain"}`).join(", ")}`);
  L.push(`Votes so far: ${vd.length ? vd.join(" | ") : "none yet"}.`);
  const heat = {};
  Object.entries(S.suspects).forEach(([w, list]) => list.forEach((x) => (heat[x.who] ||= new Set()).add(w)));
  const hot = Object.entries(heat).filter(([n]) => byName(g, n)?.alive).sort((a, b) => b[1].size - a[1].size).map(([n, w]) => `${n} (suspected by ${[...w].join(", ")})`);
  L.push(`Who is suspected: ${hot.join("; ") || "nobody yet"}.`);
  const mute = Object.entries(S.silent).filter(([n, c]) => c > 0 && byName(g, n)?.alive).map(([n, c]) => `${n} (${c}x)`);
  if (mute.length) L.push(`Players who said NOTHING when it was their turn to speak: ${mute.join(", ")}. Silence is only a weak hint (some people are just quiet or careful), so do not pile on a silent player unless there are other reasons too.`);
  const silent = alive(g).filter((x) => !S.suspects[x.name]?.length && g.day > 1).map((x) => x.name);
  if (silent.length) L.push(`Players who have not named a suspect yet: ${silent.join(", ")}.`);
  return L.join("\n");
}
function userFor(g, p, task, extra = "") {
  const log = g.log.slice(-120).join("\n") || "(nothing has happened yet)";
  const partner = p.role === "werewolf" ? g.players.find((x) => x.role === "werewolf" && x !== p) : null;
  const mates = partner ? `Your fellow werewolf ${partner.name} is ${partner.alive ? "ALIVE" : "dead"}. Protect them without being obvious: do not accuse or vote for them unless that is the only way to survive.\n` : "";
  const potion = p.role === "doctor" ? `Your healing potion: ${p.potion === false ? "ALREADY USED, it is gone" : "still AVAILABLE (one use for the whole game)"}.\n` : "";
  const known = mates + potion + (p.known.length ? p.known.join("\n") : partner ? "" : "(nothing special)");
  return `=== PUBLIC LOG ===\n${log}\n\n=== TABLE FACTS (computed by the referee, accurate) ===\n${factsFor(g)}\n\n=== YOUR PRIVATE KNOWLEDGE ===\n${known}\n\n=== YOUR PRIVATE NOTES FROM EARLIER ===\n${p.notes || "(none yet)"}\n\n=== NOW ===\nTASK: ${task}\nALIVE: ${alive(g).map((x) => x.name).join(", ")}\n${extra}`;
}
const SPEC = {
  speak: `Return JSON only: {"thought":"your private reasoning in 2-4 sentences: weigh the claims, the votes and the behavior, say who benefits, and decide your plan","say":"what you say out loud, in character, max 60 words","suspect":"the one player you most suspect right now, or null","trust":"the one player you most trust right now, or null","claim":"seer, doctor or villager ONLY if your words publicly claim that role this turn, otherwise null","notes":"your updated private notes, max 60 words"}`,
  vote: `Return JSON only: {"thought":"rank the living players from most to least likely to be a werewolf, weighing concrete evidence (lies, contradictions, vote patterns, steering) above silence or style, then pick; 2-3 sentences","vote":"the name of exactly one living player other than yourself, or the single word abstain to vote for nobody (rare: abstaining helps the werewolves)","notes":"your updated private notes, max 40 words"}`,
  wolf: `Return JSON only: {"thought":"your private reasoning, 1-2 sentences","target":"the name of the living non-werewolf you want to kill","whisper":"one short sentence to your partner explaining the choice"}`,
  seer: `Return JSON only: {"thought":"your private reasoning, 1-2 sentences","target":"the name of one living player you have not inspected, other than yourself"}`,
  doctor: `Return JSON only: {"thought":"your private reasoning, 1-2 sentences","use_potion":true or false}`,
};

// Ask one AI player to act. Validates the answer; one retry on bad JSON; a safe random fallback so a game never stalls.
async function ask(g, p, task, { extra = "", valid = [], max = 700 } = {}) {
  const system = systemFor(g, p);
  const user = userFor(g, p, task, extra) + "\n" + SPEC[task];
  let out = null;
  for (let attempt = 0; attempt < 2 && !out; attempt++) {
    try {
      const r = await chat({ model: g.tier.model, reasoning: g.tier.reasoning, system, user: attempt ? user + "\nYour last answer was not valid JSON. Answer with JSON only." : user, max_tokens: max + (g.tier.reasoning.effort ? 2000 : 0) }); // thinking tokens count against the limit
      addCost(g, p.name, task, r);
      out = parseJson(r.text);
    } catch (e) {
      if (attempt) console.log(`[${p.name}] ${task} failed: ${e.message}`);
    }
  }
  out ||= {};
  const pick = (n) => valid.find((v) => v.toLowerCase() === String(n || "").trim().toLowerCase());
  const res = { thought: String(out.thought || "").slice(0, 500) };
  if (task === "speak") {
    res.say = String(out.say || "").trim().slice(0, 500) || tr(g, "fallbackSay");
    res.suspect = pick(out.suspect) || null;
    res.trust = pick(out.trust) || null;
    res.claim = ["seer", "doctor", "villager"].includes(String(out.claim).toLowerCase()) ? String(out.claim).toLowerCase() : null;
  } else if (task === "vote" && (out.abstain === true || /^(abstain|弃票|pass)$/i.test(String(out.vote ?? "").trim()))) {
    res.target = null;
  } else if (task === "doctor") {
    res.use = out.use_potion === true || String(out.use_potion).toLowerCase() === "true";
    res.target = valid[0];
  } else {
    res.target = pick(out.target ?? out.vote) || shuffle(valid)[0];
    res.whisper = String(out.whisper || "").slice(0, 200);
  }
  if (out.notes) p.notes = String(out.notes).slice(0, 500);
  if (res.thought) g.thoughts.push({ day: g.day, task, who: p.name, thought: res.thought, notes: p.notes });
  return res;
}

function human(g, kind, opts = {}) {
  return new Promise((resolve) => {
    g.waiting = true; g.resolve = resolve; g.options = opts.options || null; g.need = kind; g.canSkip = !!opts.skipLabel;
    emit(g, { type: "need", kind, day: g.day, ...opts });
  });
}

// ---- The game loop: one long coroutine, paused whenever the human has to decide something ----
const winner = (g) => {
  const a = alive(g), w = a.filter((p) => p.role === "werewolf").length;
  if (w === 0) return "village";
  if (w >= a.length - w) return "werewolves";
  return null;
};
const narrate = (g, text) => emit(g, { type: "narrate", text });
const note = (g, line) => g.log.push(line);

// The moderator's script. "beat" is a minimum pause (ms) the browser holds after the line, for drama.
const beat = (g, text, ms = 1500) => emit(g, { type: "narrate", text, beat: ms });

async function night(g) {
  g.day++;
  emit(g, { type: "phase", phase: "night", day: g.day, label: `Night ${g.day}` });
  beat(g, tr(g, "night", g.day), 3200);
  const names = (list) => list.map((x) => x.name);
  const wolves = alive(g).filter((p) => p.role === "werewolf");
  const seer = alive(g).find((p) => p.role === "seer");
  const doc = alive(g).find((p) => p.role === "doctor");
  const victims = names(alive(g).filter((p) => p.role !== "werewolf"));
  const seerOpts = names(alive(g).filter((p) => p !== seer && !seer?.inspected?.has(p.name)));

  // AI actions that do not depend on each other run together while the narrator talks
  const proposals = [];
  const wolfTask = (async () => {
    for (const w of wolves.filter((x) => !x.human)) {
      const prev = proposals.length ? `Your partner suggested killing ${proposals.at(-1).target} ("${proposals.at(-1).whisper}"). You may agree or choose differently.` : "";
      proposals.push({ by: w.name, ...(await ask(g, w, "wolf", { valid: victims, extra: `Night ${g.day}: choose who the werewolves kill. Candidates: ${victims.join(", ")}. ${prev}` })) });
    }
  })();
  const seerTask = seer && !seer.human ? ask(g, seer, "seer", { valid: seerOpts, extra: `Night ${g.day}: choose one player to inspect. Candidates: ${seerOpts.join(", ")}.` }) : null;
  await Promise.all([wolfTask, seerTask]);

  // every role is called even when nobody is left in it, so the script never gives away who is alive
  beat(g, tr(g, "wolvesOpen"), 2200);
  let kill = proposals.at(-1)?.target;
  const hw = wolves.find((w) => w.human);
  if (hw) {
    const hint = proposals.length ? tr(g, "hint", proposals.at(-1).by, proposals.at(-1).whisper, proposals.at(-1).target) : "";
    if (proposals.length) emit(g, { type: "private", text: tr(g, "whisper", proposals.at(-1).by, proposals.at(-1).whisper, proposals.at(-1).target), day: g.day });
    kill = (await human(g, "night_kill", { options: victims, hint, label: tr(g, "lKill") })).target;
  }
  beat(g, tr(g, "wolvesClose"), 1600);

  let protect = null;
  beat(g, tr(g, "seerOpen"), seer ? 1800 : 3500);
  if (seer) {
    const t = seer.human ? (await human(g, "night_seer", { options: seerOpts, label: tr(g, "lSeer") })).target : (await seerTask).target;
    (seer.inspected ||= new Set()).add(t);
    const isWolf = byName(g, t).role === "werewolf";
    seer.known.push(`Night ${g.day}: you inspected ${t}: ${isWolf ? "WEREWOLF" : "NOT a werewolf"}.`);
    if (seer.human) emit(g, { type: "private", text: tr(g, "inspected", t, isWolf), day: g.day });
  }
  beat(g, tr(g, "seerClose"), 1600);

  beat(g, tr(g, "doctorOpen"), doc ? 1800 : 3500);
  if (doc) {
    doc.potion ??= true;
    const shown = tr(g, "docSees", kill);
    if (doc.human) emit(g, { type: "private", text: "🩺 " + shown, day: g.day });
    if (!doc.potion) {
      if (doc.human) emit(g, { type: "private", text: tr(g, "docEmpty"), day: g.day });
    } else {
      // the doctor sees tonight's victim and decides whether to spend the single potion
      const use = doc.human
        ? !(await human(g, "night_doctor", { options: [kill], hint: shown + " " + tr(g, "docOnce"), label: tr(g, "lDoctor"), skipLabel: tr(g, "docSkip") })).skip
        : (await ask(g, doc, "doctor", { valid: [kill], extra: `Night ${g.day}: ${shown} You still have your ONE healing potion. Use it now to save ${kill}, or keep it for a later night? Answer use_potion true or false.` })).use;
      if (use) { doc.potion = false; protect = kill; }
      doc.known.push(`Night ${g.day}: the werewolves chose to kill ${kill}; you ${use ? "USED your healing potion to save them (the potion is now gone)" : "kept your healing potion"}.`);
      if (doc.human) emit(g, { type: "private", text: use ? tr(g, "protectedMsg", kill) : tr(g, "docKept"), day: g.day });
    }
  }
  beat(g, tr(g, "doctorClose"), 1600);
  wolves.forEach((w) => w.known.push(`Night ${g.day}: the werewolves chose to kill ${kill}.`));
  return { kill, protect };
}

function kill(g, p, cause) {
  p.alive = false;
  note(g, `[Day ${g.day}] ${p.name} ${cause === "wolves" ? "was killed in the night" : "was eliminated by vote"}.${g.reveal ? ` They were a ${p.role}.` : ""}`);
  emit(g, { type: "death", who: p.name, role: g.reveal ? p.role : null, cause, day: g.day });
  sendState(g);
}

async function day(g, { kill: target, protect }) {
  emit(g, { type: "phase", phase: "day", day: g.day, label: `Day ${g.day}` });
  const t = byName(g, target);
  beat(g, tr(g, "dawn"), 2600);
  if (t && target !== protect) {
    beat(g, tr(g, "killed", t.name, g.reveal ? roleName(g, t.role) : null), 2200);
    kill(g, t, "wolves");
  } else {
    beat(g, tr(g, "nobody"), 2200);
    note(g, `[Night ${g.day}] Nobody died.`);
  }
  let w = winner(g); if (w) return w;

  const living = alive(g);
  const start = (g.day - 1) % living.length;
  const order = [...living.slice(start), ...living.slice(0, start)];
  for (let r = 1; r <= g.rounds; r++) {
    beat(g, tr(g, "round", r, g.rounds), 1200);
    for (const p of order) {
      if (!p.alive) continue;
      const others = names2(living, p);
      let ev;
      if (p.human) {
        const a = await human(g, "speak", { options: others, round: r, rounds: g.rounds });
        if (!String(a.text || "").trim()) g.stats.silent[p.name] = (g.stats.silent[p.name] || 0) + 1;
        ev = { text: String(a.text || "").trim().slice(0, 600) || tr(g, "silent"), suspect: byName(g, a.suspect)?.name || null, trust: null, claim: null };
      } else {
        emit(g, { type: "thinking", who: p.name });
        const out = await ask(g, p, "speak", { valid: others, max: 800, extra: `Day ${g.day}, discussion round ${r} of ${g.rounds}. It is your turn to speak.` });
        ev = { text: out.say, suspect: out.suspect, trust: out.trust, claim: out.claim };
      }
      note(g, `[Day ${g.day} R${r}] ${p.name}: ${ev.text}`);
      recordSay(g, { who: p.name, day: g.day, ...ev });
      emit(g, { type: "say", who: p.name, day: g.day, round: r, ...ev });
    }
  }

  // vote: everybody decides without seeing the others' votes, then all votes are revealed together
  beat(g, tr(g, "voteTime"), 2000);
  emit(g, { type: "phase", phase: "vote", day: g.day, label: `Day ${g.day}: vote` });
  const votes = {};
  const aiVoters = living.filter((p) => !p.human);
  await Promise.all(aiVoters.map(async (p) => { votes[p.name] = (await ask(g, p, "vote", { valid: names2(living, p), extra: `Voting time on day ${g.day}. Vote to eliminate exactly one living player other than yourself, or abstain. Weigh concrete evidence most: lies, contradictions, suspicious votes, and who tried to steer the vote. Silence or a short answer is only a weak hint, so never vote someone out for that alone; a quiet player may just be shy or careful. If you truly have no solid reason on day 1, abstaining is acceptable. Do not vote for someone merely because they are the loudest accuser.` })).target; }));
  const me = g.players.find((p) => p.human);
  if (me.alive) { const a = await human(g, "vote", { options: names2(living, me), label: tr(g, "lVote"), skipLabel: tr(g, "lAbstain") }); votes[me.name] = a.skip ? null : a.target; }
  const tally = {};
  for (const p of living) {
    const v = votes[p.name] ?? null;
    note(g, v ? `[Day ${g.day} vote] ${p.name} voted for ${v}.` : `[Day ${g.day} vote] ${p.name} abstained.`);
    ((g.stats.votes[g.day] ||= {})[p.name] = v);
    emit(g, { type: "vote", who: p.name, target: v, day: g.day });
    if (v) tally[v] = (tally[v] || 0) + 1;
  }
  if (!Object.keys(tally).length) {
    beat(g, tr(g, "allAbstain"), 1800);
    note(g, `[Day ${g.day}] Everybody abstained. Nobody eliminated.`);
    return winner(g);
  }
  const top = Math.max(...Object.values(tally));
  const leaders = Object.keys(tally).filter((n) => tally[n] === top);
  if (leaders.length === 1) {
    const out = byName(g, leaders[0]);
    beat(g, tr(g, "eliminated", out.name, top, g.reveal ? roleName(g, out.role) : null), 2200);
    kill(g, out, "vote");
  } else {
    beat(g, tr(g, "tie", leaders), 1800);
    note(g, `[Day ${g.day}] Tie vote between ${leaders.join(" and ")}. Nobody eliminated.`);
  }
  return winner(g);
}
const names2 = (list, except) => list.filter((x) => x !== except).map((x) => x.name);

async function play(g) {
  try {
    const me = g.players.find((p) => p.human);
    const partner = me.role === "werewolf" ? g.players.find((p) => p.role === "werewolf" && p !== me)?.name : null;
    emit(g, { type: "start", id: g.id, you: { name: me.name, role: me.role, partner }, players: publicPlayers(g), rounds: g.rounds, reveal: g.reveal, model: g.tier.model, tier: g.tier.id, lang: g.lang });
    let w = null;
    while (!w) {
      const n = await night(g);
      w = await day(g, n);
    }
    g.over = true;
    const roles = Object.fromEntries(g.players.map((p) => [p.name, p.role]));
    beat(g, tr(g, w === "village" ? "winVillage" : "winWolves"), 2500);
    emit(g, { type: "over", winner: w, roles, thoughts: g.thoughts, cost: g.cost, calls: g.calls, tokens: g.tokens, ledger: g.ledger, youWon: (w === "werewolves") === (me.role === "werewolf") });
    await logCost({ type: "game", id: g.id, cost: g.cost, calls: g.calls, model: g.tier.model, lang: g.lang });
    await mkdir(GAMES_DIR, { recursive: true });
    await writeFile(path.join(GAMES_DIR, `game-${new Date(g.started).toISOString().replace(/[:.]/g, "-")}-${g.id}.json`), JSON.stringify({ model: g.tier.model, lang: g.lang, roles, winner: w, cost: g.cost, ledger: g.ledger, history: g.history }, null, 1));
  } catch (e) {
    console.log("game error:", e);
    g.over = true;
    emit(g, { type: "error", error: e.message });
  }
}

// ---- Post-game analysis (optional, costs a few tenths of a cent) ----
async function analyze(g) {
  const me = g.players.find((p) => p.human);
  const roles = g.players.map((p) => `${p.name}: ${p.role}${p.human ? " (the human player)" : ""}`).join("\n");
  const thoughts = g.thoughts.map((t) => `Day ${t.day} ${t.who} (${t.task}): ${t.thought}`).join("\n");
  const r = await chat({
    model: g.tier.model, reasoning: g.tier.reasoning, max_tokens: 1600,
    system: "You are a sharp Werewolf coach reviewing a finished game for the human player. Be concrete: name players, days and quotes. Plain text with short headings, no markdown tables.",
    user: `The human player was ${me.name}, the ${me.role}.\nROLES:\n${roles}\n\nPUBLIC LOG:\n${g.log.join("\n")}\n\nTHE AI PLAYERS' PRIVATE THOUGHTS:\n${thoughts}\n\nWrite: 1) turning points, 2) the best and worst plays by each side, 3) tells that gave the werewolves away or let them hide, 4) three specific things ${me.name} could do better next time.\n${LANGS[g.lang].instr}`,
  });
  addCost(g, "Analyst", "analysis", r);
  await logCost({ type: "analysis", id: g.id, cost: r.cost });
  return { text: r.text, cost: r.cost, total: g.cost, calls: g.calls, tokens: g.tokens, ledger: g.ledger };
}

// ---- "Study online": one web-search call that rewrites the strategy guide, cached on disk ----
async function study() {
  const r = await chat({
    model: STUDY_MODEL, max_tokens: 2800, reasoning: { enabled: false }, plugins: [{ id: "web", max_results: 6 }],
    system: "You are a researcher who writes strategy guides for the social deduction game Werewolf (also called Mafia).",
    user: `Search the web for expert strategy advice for Werewolf / Mafia (strategy wikis, guides, forum posts). Then write a guide for AI players in exactly this format: five sections that start with the lines "## GENERAL", "## WEREWOLF", "## SEER", "## DOCTOR", "## VILLAGER". Each section has 5 to 7 concrete bullet points of one or two sentences: what to say, when to reveal a role, who to target at night, how to read votes and catch lies. The game has 7 players: 2 werewolves, 1 seer, 1 doctor, 3 villagers, with a discussion and a vote every day, and the doctor has a single healing potion for the whole game: each night they learn the werewolves' victim and may use the potion to save them, once. Under 800 words total. Output only the guide, starting with "## GENERAL".`,
  });
  const text = r.text.slice(Math.max(0, r.text.indexOf("## GENERAL")));
  const sections = parseStrategy(text);
  if (!["GENERAL", "WEREWOLF", "SEER", "DOCTOR", "VILLAGER"].every((k) => (sections[k] || "").trim().length > 80)) throw new Error("The research came back incomplete. Try again.");
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  await mkdir(path.dirname(STRATEGY_WEB), { recursive: true });
  await writeFile(STRATEGY_WEB, `<!-- ${stamp} -->\n${text}\n`);
  await loadStrategy();
  await logCost({ type: "study", cost: r.cost });
  return { cost: r.cost };
}

// ---- HTTP ----
const readBody = (req) => new Promise((resolve, reject) => {
  const c = []; req.on("data", (x) => c.push(x));
  req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(c).toString() || "{}")); } catch (e) { reject(e); } });
  req.on("error", reject);
});
const json = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(await readFile(path.join(ROOT, "public/index.html")));
    }
    if (req.method === "GET" && url.pathname === "/api/config") {
      return json(res, 200, {
        roster: ROSTER.map(({ id, name, nameZh, title, titleZh, style, styleZh, avatar, color, voice }) => ({ id, name, nameZh, title, titleZh, style, styleZh, avatar, color, voice })),
        tiers: TIERS.map((t) => ({ id: t.id, model: t.model, price: t.price, estimate: (GAME_TOKENS * (0.92 * t.price[0] + 0.08 * t.price[1])) / 1e6 })), defaultTier: tierOf(DEFAULT_TIER).id,
        langs: Object.values(LANGS).map(({ code, name }) => ({ code, name })), strategy: { source: strategy.source, updated: strategy.updated },
        hasKey: !!KEY, allTime: await allTime(),
      });
    }
    if (req.method === "GET" && url.pathname === "/api/strategy") return json(res, 200, { source: strategy.source, updated: strategy.updated, text: strategy.text });
    if (req.method === "POST" && url.pathname === "/api/study") {
      if (!KEY) return json(res, 400, { error: "OPENROUTER_API_KEY is not set." });
      const b = await readBody(req);
      if (b.reset) { await rm(STRATEGY_WEB, { force: true }); await loadStrategy(); return json(res, 200, { source: strategy.source, text: strategy.text }); }
      try { const r = await study(); return json(res, 200, { ...r, source: strategy.source, updated: strategy.updated, text: strategy.text }); } catch (e) { return json(res, 502, { error: e.message }); }
    }
    if (req.method === "GET" && ["/music.js", "/i18n.js"].includes(url.pathname)) {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" });
      return res.end(await readFile(path.join(ROOT, "public", url.pathname)));
    }
    if (req.method === "POST" && url.pathname === "/api/new") {
      if (!KEY) return json(res, 400, { error: "OPENROUTER_API_KEY is not set. Put it in .env and restart." });
      const b = await readBody(req);
      const ids = (b.roster || []).filter((i) => ROSTER.some((r) => r.id === i));
      if (ids.length !== 6) return json(res, 400, { error: "Pick exactly 6 players." });
      const g = createGame({ lang: b.lang, tier: b.tier, name: b.name, avatar: String(b.avatar || "").slice(0, 8), title: b.title, role: b.role, ids, rounds: Math.min(Math.max(Number(b.rounds) || 2, 1), 3), reveal: b.reveal !== false });
      games.set(g.id, g);
      play(g);
      return json(res, 200, { id: g.id });
    }
    if (req.method === "GET" && url.pathname === "/api/history") {
      const g = games.get(url.searchParams.get("id"));
      return g ? json(res, 200, { events: g.history, waiting: g.waiting, over: g.over }) : json(res, 404, { error: "Game not found (the server was restarted?)" });
    }
    if (req.method === "POST" && url.pathname === "/api/step") {
      const b = await readBody(req);
      const g = games.get(b.id);
      if (!g) return json(res, 404, { error: "Game not found (the server was restarted?)" });
      if (b.input) {
        if (!g.waiting) return json(res, 409, { error: "The game is not waiting for you right now." });
        if (g.options && !(g.canSkip && b.input.skip) && !g.options.some((o) => o === b.input.target)) {
          if (g.need !== "speak") return json(res, 400, { error: "That is not a valid choice." });
        }
        const r = g.resolve; g.waiting = false; g.resolve = null; g.options = null; g.need = null;
        r(b.input);
      }
      res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-cache" });
      let i = Number.isInteger(b.since) ? b.since : g.history.length;
      let closed = false; req.on("close", () => { closed = true; });
      for (;;) {
        while (i < g.history.length) res.write(JSON.stringify(g.history[i++]) + "\n");
        if (closed || g.waiting || g.over) break;
        await new Promise((r) => { g.waiters.push(r); setTimeout(r, 15000); });
      }
      return res.end();
    }
    if (req.method === "POST" && url.pathname === "/api/analyze") {
      const g = games.get((await readBody(req)).id);
      if (!g) return json(res, 404, { error: "Game not found" });
      if (!g.over) return json(res, 400, { error: "Finish the game first." });
      g.analysis ||= await analyze(g);
      return json(res, 200, g.analysis);
    }
    res.writeHead(404).end("Not found");
  } catch (e) {
    if (!res.headersSent) json(res, 500, { error: e.message }); else res.end();
  }
}).listen(PORT, async () => { await loadStrategy(); console.log(`Werewolf on http://localhost:${PORT} (strategy guide: ${strategy.source})`); });
