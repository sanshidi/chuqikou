/**
 * Meaning-aware treehole acceptance tests (Node, no browser).
 */
import fs from "fs";
import vm from "vm";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(__dirname, "../js/companion.js"), "utf8");

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  Math,
  Array,
  Object,
  String,
  Number,
  RegExp,
  Set,
  Map,
  Promise,
  document: {
    readyState: "complete",
    getElementById: () => null,
    addEventListener: () => {},
    createElement: () => ({
      classList: { add() {}, toggle() {} },
      appendChild() {},
      setAttribute() {},
      addEventListener() {},
      style: {},
    }),
    querySelectorAll: () => [],
  },
  navigator: {},
  window: {},
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

vm.runInNewContext(code, sandbox, { filename: "companion.js" });
const VC = sandbox.window.VentCompanion;
if (!VC || typeof VC.ruleReply !== "function") {
  console.error("FAIL: VentCompanion.ruleReply not exported");
  process.exit(1);
}

let fails = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    fails++;
  } else {
    console.log("OK:", msg);
  }
}

// --- Varied messages must reflect concrete content ---
const cases = [
  {
    msg: "老板天天骂我，加班到半夜，气炸了",
    mustAny: ["老板", "加班", "气炸"],
  },
  {
    msg: "和妈妈又吵架了，催婚催得我崩溃",
    mustAny: ["妈妈", "催婚", "吵架", "崩溃"],
  },
  {
    msg: "对象给我冷暴力，已读不回，特别委屈",
    mustAny: ["对象", "冷暴力", "已读", "委屈"],
  },
  {
    msg: "房租和下个月绩效叠在一起，焦虑得睡不好",
    mustAny: ["房租", "绩效", "焦虑", "睡不好"],
  },
  {
    msg: "同事甩锅给我KPI，憋屈死了",
    mustAny: ["同事", "KPI", "憋屈"],
  },
];

// --- CRITICAL: exact live-fail sentence must include 老板 AND 加班 ---
const LIVE_FAIL = "老板天天骂我，加班到半夜，气炸了";
VC.resetSession();
{
  const reply = VC.ruleReply(LIVE_FAIL);
  assert(reply.includes("老板"), `LIVE_FAIL must include 老板\n  → ${reply}`);
  assert(reply.includes("加班"), `LIVE_FAIL must include 加班\n  → ${reply}`);
  assert(
    /^(你提到了「|关于「|「)/.test(reply),
    `LIVE_FAIL must START with key reflection\n  → ${reply}`
  );
  assert(
    !reply.includes("我在这儿听着。此刻最想对对方说"),
    `must not use old full bucket template\n  → ${reply}`
  );
  console.log("SAMPLE:", reply);
}

VC.resetSession();
for (const c of cases) {
  VC.resetSession();
  const reply = VC.ruleReply(c.msg);
  const hit = c.mustAny.some((k) => reply.includes(k));
  assert(hit, `reflect 「${c.mustAny.join("/")}」 in reply to: ${c.msg}\n  → ${reply}`);
  assert(
    /^(你提到了「|关于「|「)/.test(reply) || c.mustAny.every((k) => !reply.includes(k)),
    `reply should start with reflection when keys present\n  → ${reply}`
  );
  const keys = VC.extractKeywords(c.msg);
  assert(keys.length > 0, `extractKeywords non-empty for: ${c.msg} → ${JSON.stringify(keys)}`);
}

// Source must not contain old complete bucket reply strings
const src = fs.readFileSync(path.join(__dirname, "../js/companion.js"), "utf8");
assert(!/replies:\s*\[/.test(src), "companion.js must not have BUCKETS.replies arrays");
assert(
  !src.includes("我在这儿听着。此刻最想对对方说、却没说出口的一句是什么？"),
  "old anger full-template string must be deleted"
);

// --- 8 similar anger turns: high uniqueness + still content-aware ---
VC.resetSession();
const angerMsgs = [
  "又被老板阴阳怪气，火大",
  "老板开会点名骂我，气炸了",
  "加班到凌晨还被老板说效率低，窝火",
  "老板把锅甩给我，受够了",
  "今天老板又甩脸，怒到想砸东西",
  "被老板当众羞辱，憋屈",
  "老板的微信消息一看就来气",
  "还是老板，永远不对，烦死了",
];
const replies = angerMsgs.map((m) => VC.ruleReply(m));
const unique = new Set(replies);
assert(unique.size >= 6, `8 anger turns uniqueness ${unique.size}/8 (>=6)`);
const withBoss = replies.filter((r) => r.includes("老板")).length;
assert(withBoss >= 5, `most anger replies mention 老板 (${withBoss}/8)`);

// Anti-exact-repeat consecutive
let exactDup = 0;
for (let i = 1; i < replies.length; i++) {
  if (replies[i] === replies[i - 1]) exactDup++;
}
assert(exactDup === 0, `no consecutive identical replies (dups=${exactDup})`);

console.log("\n--- sample replies ---");
cases.forEach((c, i) => {
  VC.resetSession();
  console.log(`[${i + 1}] USER: ${c.msg}`);
  console.log(`    BOT: ${VC.ruleReply(c.msg)}`);
});
console.log("\n--- 8-turn anger ---");
VC.resetSession();
angerMsgs.forEach((m, i) => {
  console.log(`[${i + 1}] ${m}`);
  console.log(`    → ${VC.ruleReply(m)}`);
});


// --- Meaning-aware: prefer concrete LEX pair (同事+KPI, not just 甩锅) ---
VC.resetSession();
{
  const msg = "同事甩锅给我KPI，憋屈死了";
  const keys = VC.extractKeywords(msg);
  assert(keys.includes("同事"), `keys must include 同事 → ${JSON.stringify(keys)}`);
  assert(keys.includes("KPI"), `keys must include KPI → ${JSON.stringify(keys)}`);
  const reply = VC.ruleReply(msg);
  assert(reply.includes("同事"), `reply must echo 同事\n  → ${reply}`);
  assert(reply.includes("KPI"), `reply must echo KPI (concrete noun)\n  → ${reply}`);
}

// --- Cold-violence case must echo 冷暴力 ---
VC.resetSession();
{
  const msg = "对象给我冷暴力，已读不回，特别委屈";
  const keys = VC.extractKeywords(msg);
  assert(keys.includes("冷暴力") || keys.includes("对象"), `keys touch relation → ${JSON.stringify(keys)}`);
  const reply = VC.ruleReply(msg);
  const hit = ["冷暴力", "对象", "已读不回", "已读", "委屈"].filter((k) => reply.includes(k));
  assert(hit.length >= 2, `must echo ≥2 concrete keys (${hit})\n  → ${reply}`);
}

// --- Crisis path ---
VC.resetSession();
{
  const crisisMsgs = ["我不想活了", "有点想自杀", "想结束生命"];
  for (const m of crisisMsgs) {
    const reply = VC.ruleReply(m);
    assert(/400-161-9995/.test(reply), `crisis must include hotline for: ${m}`);
    assert(/希望24|生命热线|专业/.test(reply), `crisis must mention support for: ${m}`);
    assert(!/心理医生/.test(reply) || /不是心理医生|不能替代/.test(reply), `must not claim therapist: ${m}`);
  }
}

// --- Mid section should often weave a key (not tone-only) across 5 fresh sessions ---
{
  let woven = 0;
  const samples = [
    "老板天天骂我，加班到半夜，气炸了",
    "房租和下个月绩效叠在一起，焦虑得睡不好",
    "和妈妈又吵架了，催婚催得我崩溃",
    "对象给我冷暴力，已读不回，特别委屈",
    "同事甩锅给我KPI，憋屈死了",
  ];
  for (const m of samples) {
    VC.resetSession();
    const keys = VC.extractKeywords(m).slice(0, 2);
    const reply = VC.ruleReply(m);
    if (keys.every((k) => reply.includes(k))) woven++;
  }
  assert(woven >= 4, `≥4/5 replies echo top-2 keys (got ${woven}/5)`);
}

if (fails) {
  console.error(`\n${fails} assertion(s) failed`);
  process.exit(1);
}
console.log("\nALL companion tests passed");
