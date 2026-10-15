/**
 * 出气口 — 树洞伙伴（倾听者）
 * Primary: offline rule/template empathy chat + crisis routing
 * Optional: WebLLM (WebGPU) lazy-load; falls back to rules if unavailable
 * NOT a therapist / 心理医生. Local-only. No API keys.
 */
(function () {
  "use strict";

  const ROLE = "树洞伙伴";
  const ROLE_SUB = "倾听者 · 非心理医生";
  const HOTLINE_TEXT =
    "若你正很难受，或有伤害自己的念头，请尽快联系专业支持：\n" +
    "· 希望24热线 400-161-9995\n" +
    "· 生命热线 https://www.lifeline.org.cn/\n" +
    "本页不能替代医疗或心理咨询。";

  const CRISIS_RE =
    /自杀|不想活|结束生命|了结自己|活不下去|自我了断|自残|割腕|跳楼|寻死|去死|结束一切|没有活着的意义|不想醒来|轻生/;

  const WEBLLM_MODEL = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";
  const WEBLLM_CDN = "https://esm.run/@mlc-ai/web-llm";

  const SYSTEM_PROMPT =
    "你是「树洞伙伴」，一位温柔的倾听者。你不是心理医生，不做诊断、不开药方、不替代专业帮助。" +
    "用简短自然的中文回应（通常 2～4 句）：先共情与复述感受，再轻轻问一句开放问题。" +
    "不要说教，不要列长清单。若用户流露自伤或自杀意念，温和提醒寻求真人专业支持，并提及热线 400-161-9995。" +
    "永远不要自称心理医生、咨询师或治疗师。";

  /* —— Emotion buckets (tone only; NEVER used as full replies) —— */
  const BUCKETS = [
    { id: "anger", re: /怒|气炸|生气|愤怒|烦死|受够|忍无可忍|火大|窝火|憋屈|恨|想砸|想骂/ },
    { id: "fatigue", re: /累|疲惫|撑不住|没力气|崩溃|透支|倦|睡不好|失眠|心力交瘁/ },
    { id: "anxiety", re: /焦虑|紧张|害怕|慌|担心|不安|心悸|坐立不安|恐惧|怕/ },
    { id: "sad", re: /难过|伤心|委屈|哭|失落|心酸|心痛|难受|郁闷|低落|绝望/ },
    { id: "lonely", re: /孤独|寂寞|没人懂|一个人|被忽视|没人听|没人在意|孤单/ },
    { id: "shame", re: /羞耻|丢脸|没用|废物|失败|讨厌自己|自我厌恶|愧疚|内疚|对不起自己/ },
    { id: "work", re: /工作|上班|老板|同事|加班|裁员|KPI|压力大|职场/ },
    { id: "family", re: /家人|父母|爸爸|妈妈|亲戚|家里|原生家庭|催婚|比较/ },
    { id: "relation", re: /分手|恋爱|伴侣|对象|吵架|冷暴力|嫌弃|背叛|朋友|关系/ },
  ];

  /** Short empathy beats only — never a complete standalone reply */
  const TONE = {
    anger: ["这股火不是无来由的。", "被气到、觉得不公平，是很真实的感受。", "怒气常常在保护你不被继续伤害。"],
    fatigue: ["听起来你已经撑了很久。", "累到说不出话也很常见。", "疲惫有时是长期紧绷的信号。"],
    anxiety: ["焦虑让人一直悬着，很消耗。", "害怕被看见时，身体也会跟着紧。", "不安常常指向失控感。"],
    sad: ["心里很沉的时候，委屈也值得被看见。", "难过的时候，不必马上振作。", "眼泪和沉默都是在说话。"],
    lonely: ["感到孤单、觉得没人懂，是很沉的体验。", "一个人扛着的时候，世界会显得特别大。"],
    shame: ["对自己苛刻的时候，世界会变得很小。", "羞耻感常让人想躲起来——我不会评判你。"],
    work: ["职场的压榨感很容易把人掏空。", "工作压力不只是忙，常常还有不被看见。"],
    family: ["和家人的纠缠常常又爱又累。", "家里的期待可以很重。"],
    relation: ["关系里的伤口特别磨人。", "被冷落或争吵之后，脑子会反复回放。"],
    generic: ["听起来心里有事堵着。", "谢谢你愿意写下来。", "我接住了。"],
  };


  const GREETING =
    "你好，我是树洞伙伴——倾听者，不是心理医生。\n\n" +
    "你可以随便倒情绪：工作、家里、关系、或说不清的堵。内容只在本机，不会上传。\n\n" +
    "若正难受到想伤害自己，请先打热线，再回来写也完全可以。\n" +
    "希望24：400-161-9995\n\n" +
    "点上方小标签起个头，或直接写下此刻最堵的一句。";

  /* —— State —— */
  let mode = "rule"; // "rule" | "webllm"
  let webllmEngine = null;
  let webllmLoading = false;
  let webllmMessages = [{ role: "system", content: SYSTEM_PROMPT }];
  let busy = false;
  let lastBucket = null;
  let lastReplies = []; // anti-repeat last N
  let sessionTheme = null; // progressive in-session theme
  let turnCount = 0;
  let knownKeys = []; // keys echoed this session

  const el = {
    section: null,
    log: null,
    input: null,
    send: null,
    status: null,
    modeRule: null,
    modeLlm: null,
    llmProgress: null,
    clear: null,
  };

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function detectCrisis(text) {
    return CRISIS_RE.test(text || "");
  }

  function crisisReply() {
    return (
      "听起来你现在非常痛苦，这些念头很沉重——你值得被认真对待，而不是独自扛着。\n\n" +
      "我只是树洞里的倾听者，不能替代专业帮助。请尽快联系能真正支持你的人：\n\n" +
      HOTLINE_TEXT +
      "\n\n若你愿意，也可以继续把感受写在这里；同时请优先联系热线或身边可信的人。"
    );
  }

  const STOP = new Set(
    "的了吗呢吧啊呀嘛着过就都还很不也在是有我你他她它们这那什么怎么为什么可是但是因为所以如果只是有点有些真的一下一些已经还是不是没有这么那么自己感觉觉得想要还想一下一下下".split("")
  );
  // Multi-char stop phrases
  const STOP_PHRASES = [
    "真的", "有点", "有些", "一下", "一些", "已经", "还是", "不是", "没有",
    "这么", "那么", "自己", "感觉", "觉得", "想要", "还想", "就是", "然后",
    "今天", "昨天", "明天", "现在", "一直", "突然", "特别", "非常", "好多",
    "什么", "怎么", "为什么", "可以", "应该", "可能", "好像", "其实", "反正",
  ];

  function extractKeywords(text) {
    const t = (text || "").trim();
    const scored = []; // {k, score}
    const seen = new Set();

    function add(k, score) {
      const s = (k || "").trim();
      if (s.length < 2 || s.length > 14) return;
      if (STOP_PHRASES.includes(s)) return;
      if (!/[\u4e00-\u9fffA-Za-z0-9]/.test(s)) return;
      if (seen.has(s)) {
        // bump score if already present
        const prev = scored.find((x) => x.k === s);
        if (prev && score > prev.score) prev.score = score;
        return;
      }
      seen.add(s);
      scored.push({ k: s, score: score || 1 });
    }

    // 1) Quoted spans — high priority
    const quoteRe = /[「『"“]([^」』"”]{2,12})[」』"”]/g;
    let m;
    while ((m = quoteRe.exec(t))) add(m[1], 50);

    // 2) Topic lexicon — always keep
    const LEX = [
      "老板", "同事", "加班", "裁员", "KPI", "绩效", "开会", "客户", "甲方", "领导",
      "父母", "妈妈", "爸爸", "亲戚", "催婚", "原生家庭", "家里",
      "对象", "伴侣", "分手", "冷暴力", "吵架", "背叛", "朋友", "前任",
      "房租", "房贷", "工资", "负债", "失业", "加班费",
      "失眠", "睡不好", "头疼", "胸口", "心慌", "胃痛",
      "考试", "论文", "导师", "学校", "实习", "答辩",
      "微信", "电话", "消息", "已读", "已读不回",
      "阴阳怪气", "甩锅", "点名", "羞辱", "甩脸", "效率",
    ];
    for (const w of LEX) {
      if (t.includes(w)) add(w, 100);
    }

    // 3) Emotion words in text
    const EMO = [
      "气炸", "愤怒", "窝火", "憋屈", "受够", "崩溃", "透支", "焦虑",
      "害怕", "委屈", "心酸", "孤独", "寂寞", "羞耻", "没用", "废物",
      "绝望", "烦死", "火大", "撑不住", "想砸", "来气", "怒到",
    ];
    for (const w of EMO) {
      if (t.includes(w)) add(w, 80);
    }

    // 4) Punctuation-separated clauses (human phrases, not sliding grams)
    const clauses = t
      .split(/[，。！？、；;\n,.!?]+/)
      .map((c) => c.trim())
      .filter((c) => c.length >= 2 && c.length <= 14);
    for (const c of clauses) {
      // strip leading filler
      let cleaned = c.replace(/^(我|又|被|和|跟|对|把|让|给|还是|今天|昨天)/, "");
      if (cleaned.length < 2) cleaned = c;
      let stopish = 0;
      for (const ch of cleaned) if (STOP.has(ch)) stopish++;
      if (stopish / cleaned.length >= 0.55) continue;
      // Prefer clauses that contain a lexicon hit
      const hasLex = LEX.some((w) => cleaned.includes(w));
      add(cleaned, hasLex ? 40 : 20);
    }

    // Sort: score desc, then lexicon/emo boost, then prefer shorter concrete
    function isLex(k) { return LEX.includes(k); }
    function isEmo(k) { return EMO.includes(k); }
    scored.sort((a, b) => {
      const boost = (x) => (isLex(x.k) ? 30 : 0) + (isEmo(x.k) ? 12 : 0) - (x.k.length > 6 ? 4 : 0);
      const sa = a.score + boost(a);
      const sb = b.score + boost(b);
      return sb - sa || a.k.length - b.k.length;
    });

    const out = [];
    for (const { k } of scored) {
      let skip = false;
      for (const u of out) {
        if (u === k) { skip = true; break; }
        if (u.includes(k) && u.length - k.length <= 2) { skip = true; break; }
        if (k.includes(u) && isLex(u)) {
          if (k.length > u.length + 4) {
            /* allow both */
          } else if (!isLex(k) && !isEmo(k)) {
            skip = true;
            break;
          }
        }
      }
      if (skip) continue;
      out.push(k);
      if (out.length >= 5) break;
    }

    // Force concrete LEX hits into the front of the list (meaning-aware priority)
    const lexHits = LEX.filter((w) => t.includes(w));
    // Prefer longer lexicon phrases first (已读不回 > 已读)
    lexHits.sort((a, b) => b.length - a.length || LEX.indexOf(a) - LEX.indexOf(b));
    const preferred = [];
    for (const w of lexHits) {
      if (preferred.some((p) => p.includes(w) || w.includes(p))) continue;
      preferred.push(w);
      if (preferred.length >= 3) break;
    }
    for (const w of preferred) {
      if (!out.includes(w)) {
        const idx = out.findIndex((x) => !isLex(x) && !isEmo(x));
        if (out.length < 5) out.unshift(w);
        else if (idx >= 0) out[idx] = w;
        else out[out.length - 1] = w;
      }
    }
    // Stable: move preferred LEX to front while keeping relative order of others
    const front = preferred.filter((w) => out.includes(w));
    const rest = out.filter((w) => !front.includes(w));
    const merged = front.concat(rest).slice(0, 5);

    for (const w of EMO) {
      if (t.includes(w) && !merged.includes(w) && merged.length < 5) merged.push(w);
    }

    return merged;
  }

  function detectBucket(t) {
    for (const b of BUCKETS) {
      if (b.re.test(t)) return b;
    }
    return null;
  }

  function reflectClause(keys) {
    if (!keys || !keys.length) return "";
    const show = keys.slice(0, 2);
    if (show.length === 1) return "你提到了「" + show[0] + "」";
    return "你提到了「" + show[0] + "」和「" + show[1] + "」";
  }

  function rememberKeys(keys) {
    for (const k of keys) {
      if (!knownKeys.includes(k)) knownKeys.push(k);
    }
    if (knownKeys.length > 12) knownKeys = knownKeys.slice(-12);
  }

  function pickUnique(candidates, nRecent) {
    nRecent = nRecent || 6;
    const recent = lastReplies.slice(-nRecent);
    const recentFp = recent.map((r) => String(r).slice(0, 18));
    let fresh = candidates.filter((c) => !recent.includes(c));
    // Also avoid same opening fingerprint when possible
    const fpFresh = fresh.filter((c) => !recentFp.includes(String(c).slice(0, 18)));
    if (fpFresh.length) fresh = fpFresh;
    const pool = fresh.length ? fresh : candidates;
    return pick(pool);
  }

  function commitReply(reply) {
    lastReplies.push(reply);
    if (lastReplies.length > 16) lastReplies = lastReplies.slice(-16);
    turnCount += 1;
    return reply;
  }

  function joinParts(parts) {
    return parts
      .filter(Boolean)
      .map((p) => {
        let s = String(p).trim();
        if (!s) return "";
        // Ensure sentence end so parts don't glue into one run-on
        if (!/[。！？…]$/.test(s)) s += "。";
        return s;
      })
      .join("");
  }

  /** Hard requirement: reply must START with reflection of keys[0..1] when keys exist. */
  function forceReflectStart(reply, keys) {
    if (!keys || !keys.length) return reply;
    const head = reflectClause(keys);
    const must = keys.slice(0, 2);
    const startsOk =
      reply.startsWith(head) ||
      reply.startsWith("你提到了「" + must[0] + "」") ||
      reply.startsWith("关于「" + must[0] + "」") ||
      (must[1] &&
        (reply.startsWith("「" + must[0] + "」和「" + must[1] + "」") ||
          reply.startsWith("「" + must[0] + "」加上「" + must[1] + "」") ||
          reply.startsWith("关于「" + must[0] + "」和「" + must[1] + "」"))) ||
      (must.length === 1 && reply.startsWith("「" + must[0] + "」"));
    const hasAll = must.every((k) => reply.includes(k));
    if (startsOk && hasAll) return reply;
    // Strip a broken leading reflect, then prepend canonical head
    let rest = reply.replace(
      /^(你提到了「[^」]+」(和「[^」]+」)?[。．—\-—，,.]*|关于「[^」]+」(和「[^」]+」)?[，。]*|「[^」]+」(和|加上)「[^」]+」[^\u4e00-\u9fff]{0,12}|「[^」]+」这两个字[^\u4e00-\u9fff]{0,8})/,
      ""
    );
    rest = rest.trim();
    if (!rest) rest = "我接住了。你愿意多说一点吗？";
    return joinParts([head + "。", rest]);
  }

  function buildReflective(text, keys, bucket) {
    const key0 = keys[0] || "";
    const key1 = keys[1] || "";
    const theme = sessionTheme;

    const deepen =
      theme &&
      bucket &&
      theme === bucket.id &&
      turnCount >= 2 &&
      Math.random() < 0.55;

    // Opener ALWAYS reflects keys when present (variants all contain key0 and key1)
    let opener = "我在听。";
    if (keys.length >= 2) {
      opener = pickUnique([
        "你提到了「" + key0 + "」和「" + key1 + "」。",
        "关于「" + key0 + "」和「" + key1 + "」，我听见了。",
        "「" + key0 + "」和「" + key1 + "」叠在一起，确实容易把人压扁。",
        "你提到了「" + key0 + "」和「" + key1 + "」——这话里压着不少力气。",
        "「" + key0 + "」加上「" + key1 + "」，听起来这一阵子并不轻松。",
      ]);
    } else if (keys.length === 1) {
      opener = pickUnique([
        "你提到了「" + key0 + "」。",
        "关于「" + key0 + "」，我听见了。",
        "你提到了「" + key0 + "」——听起来这件事在你心里占了很大一块。",
        "「" + key0 + "」这两个字一出来，分量就不轻。",
      ]);
    }

    const toneList = (bucket && TONE[bucket.id]) || TONE.generic;
    // Mid: weave concrete keys into empathy so replies feel meaning-aware, not generic tone-only
    const midCands = toneList.slice();
    if (key0 && key1) {
      midCands.push(
        "「" + key0 + "」和「" + key1 + "」缠在一起时，人很容易只剩紧绷。",
        "先被「" + key0 + "」戳一下，再被「" + key1 + "」压住——委屈会叠层。",
        "听你讲「" + key0 + "」和「" + key1 + "」，我能感到里头的火气或不甘。"
      );
    } else if (key0) {
      midCands.push(
        "「" + key0 + "」这件事，听起来不是一句「想开点」能打发的。",
        "和「" + key0 + "」较劲的时候，人会特别需要被接住。"
      );
    }
    const mid = pickUnique(midCands);

    const questions = [];
    if (key0 && key1) {
      questions.push(
        "关于「" + key0 + "」和「" + key1 + "」，哪一块更想先倒出来？",
        "「" + key0 + "」这件事，和「" + key1 + "」叠在一起时，你最堵的一句是什么？",
        "如果只能先放下一个，你更想暂时放下「" + key0 + "」还是「" + key1 + "」？",
        "「" + key1 + "」出现的时候，「" + key0 + "」让你最先想到的画面是什么？",
        "此刻说「" + key0 + "」和「" + key1 + "」，你更想被理解情绪，还是一起理清发生了什么？"
      );
    } else if (key0) {
      questions.push(
        "关于「" + key0 + "」，此刻最堵的那一句是什么？",
        "「" + key0 + "」这件事，你最想对谁说一句却还没说出口？",
        "「" + key0 + "」让你最难受的，是不公平，还是无力感？",
        "如果把「" + key0 + "」写成一句话发给信任的人，你会怎么开头？"
      );
    }
    if (deepen && knownKeys.length) {
      const earlier = knownKeys.filter((k) => !keys.includes(k)).slice(-2);
      if (earlier.length) {
        questions.push(
          "你前面也提到过「" +
            earlier[0] +
            "」。它和现在说的「" +
            (key0 || "这件事") +
            "」是连在一起的吗？"
        );
      }
      questions.push(
        "同一主题又回来了。你更想继续挖深一点，还是说说身体现在什么感觉？"
      );
    }
    if (!questions.length) {
      questions.push(
        "你愿意多说一点吗？",
        "此刻最想被接住的是哪一句？",
        "继续说也行，停一停也行——你现在更想怎样？"
      );
    }
    const q = pickUnique(questions, 8);

    let reply = joinParts([opener, mid, q]);
    reply = forceReflectStart(reply, keys);
    return reply;
  }

  function ruleReply(text) {
    const t = (text || "").trim();
    if (!t) {
      return commitReply("我在。你想说的时候，写一句就好。");
    }
    if (detectCrisis(t)) return commitReply(crisisReply());

    const keys = extractKeywords(t);
    const bucket = detectBucket(t);
    if (bucket) {
      sessionTheme = bucket.id;
      lastBucket = bucket.id;
    }
    rememberKeys(keys);

    if (!keys.length && t.length < 8) {
      return commitReply(
        "嗯，我在听。可以多写一点——发生了什么，或你现在身体什么感觉？"
      );
    }

    let reply = buildReflective(t, keys, bucket);
    // Final hard gate: keys present ⇒ reflection + every top key appears
    if (keys.length) {
      reply = forceReflectStart(reply, keys);
      const must = keys.slice(0, 2);
      const missing = must.filter((k) => !reply.includes(k));
      if (missing.length) {
        reply = joinParts([
          reflectClause(must) + "。",
          "我接住了。",
          missing.length
            ? "关于「" + must.join("」和「") + "」，你还想补充哪一句？"
            : "你愿意多说一点吗？",
        ]);
      }
      if (!reply.includes(must[0])) {
        // Absolute last resort — must never ship a keyless reply when keys exist
        reply =
          reflectClause(must) +
          "。我接住了。关于这些，你愿意多说一点吗？";
      }
    }
    return commitReply(reply);
  }

  function resetCompanionSession() {
    lastBucket = null;
    lastReplies = [];
    sessionTheme = null;
    turnCount = 0;
    knownKeys = [];
  }

  function appendMsg(role, text, opts) {
    opts = opts || {};
    const row = document.createElement("div");
    row.className = "companion-msg companion-msg--" + role;
    if (opts.crisis) row.classList.add("is-crisis");

    const who = document.createElement("span");
    who.className = "companion-who";
    who.textContent = role === "user" ? "你" : ROLE;

    const bubble = document.createElement("div");
    bubble.className = "companion-bubble";
    bubble.textContent = text;

    row.appendChild(who);
    row.appendChild(bubble);
    el.log.appendChild(row);
    el.log.scrollTop = el.log.scrollHeight;
    return bubble;
  }

  function setStatus(text, kind) {
    if (!el.status) return;
    el.status.textContent = text || "";
    el.status.dataset.kind = kind || "";
  }

  function setBusy(v) {
    busy = v;
    if (el.send) {
      el.send.disabled = v || !(el.input && el.input.value.trim());
      el.send.setAttribute("aria-busy", v ? "true" : "false");
      el.send.textContent = v ? "倾听中…" : "发送";
    }
    if (el.input) {
      el.input.disabled = v && mode === "webllm";
      el.input.setAttribute("aria-busy", v ? "true" : "false");
    }
    if (el.section) el.section.classList.toggle("is-busy", !!v);
    if (el.log) el.log.classList.toggle("is-empty", !el.log.querySelector(".companion-msg"));
  }

  async function hasWebGPU() {
    try {
      if (!navigator.gpu) return false;
      const adapter = await navigator.gpu.requestAdapter();
      return !!adapter;
    } catch (_) {
      return false;
    }
  }

  async function ensureWebLLM(onProgress) {
    if (webllmEngine) return webllmEngine;
    if (webllmLoading) throw new Error("正在加载中…");
    webllmLoading = true;
    try {
      const ok = await hasWebGPU();
      if (!ok) {
        throw new Error("当前浏览器没有可用的 WebGPU，已回到模板倾听。");
      }
      setStatus("正在加载本地小模型（首次需下载，约数百 MB）…", "load");
      const webllm = await import(/* webpackIgnore: true */ WEBLLM_CDN);
      const engine = await webllm.CreateMLCEngine(WEBLLM_MODEL, {
        initProgressCallback: (p) => {
          const msg = (p && p.text) || "加载中…";
          const prog =
            p && typeof p.progress === "number"
              ? Math.round(p.progress * 100) + "%"
              : "";
          if (onProgress) onProgress(msg, prog);
          setStatus((prog ? prog + " · " : "") + msg, "load");
          if (el.llmProgress) {
            el.llmProgress.hidden = false;
            el.llmProgress.textContent = (prog ? prog + " — " : "") + msg;
          }
        },
      });
      webllmEngine = engine;
      webllmMessages = [{ role: "system", content: SYSTEM_PROMPT }];
      if (el.llmProgress) el.llmProgress.hidden = true;
      setStatus("本地小模型已就绪（仅本机推理，无 API Key）。", "ok");
      return engine;
    } catch (err) {
      webllmEngine = null;
      mode = "rule";
      syncModeButtons();
      const msg = (err && err.message) || String(err);
      setStatus("无法启用本地模型：" + msg, "warn");
      if (el.llmProgress) {
        el.llmProgress.hidden = false;
        el.llmProgress.textContent = "已回退到模板倾听（离线、免下载）。";
      }
      throw err;
    } finally {
      webllmLoading = false;
    }
  }

  async function webllmReply(userText) {
    const engine = await ensureWebLLM();
    webllmMessages.push({ role: "user", content: userText });
    // keep context short for tiny model
    if (webllmMessages.length > 13) {
      webllmMessages = [
        webllmMessages[0],
        ...webllmMessages.slice(-12),
      ];
    }
    const replyBubble = appendMsg("bot", "…");
    let full = "";
    try {
      const chunks = await engine.chat.completions.create({
        messages: webllmMessages,
        stream: true,
        temperature: 0.7,
        max_tokens: 180,
      });
      for await (const chunk of chunks) {
        const delta =
          chunk &&
          chunk.choices &&
          chunk.choices[0] &&
          chunk.choices[0].delta &&
          chunk.choices[0].delta.content;
        if (delta) {
          full += delta;
          replyBubble.textContent = full;
          el.log.scrollTop = el.log.scrollHeight;
        }
      }
      if (!full.trim()) {
        full = ruleReply(userText);
        replyBubble.textContent = full;
      }
      webllmMessages.push({ role: "assistant", content: full });
      // Client-side crisis overlay if model missed it
      if (detectCrisis(userText) && !/400-161-9995|热线/.test(full)) {
        const extra = document.createElement("div");
        extra.className = "companion-crisis-note";
        extra.textContent =
          "补充：若你正有伤害自己的念头，请联系 400-161-9995（希望24）或生命热线。";
        replyBubble.parentElement.appendChild(extra);
      }
      return full;
    } catch (err) {
      replyBubble.textContent =
        "本地模型出了点问题，先用模板回复：\n" + ruleReply(userText);
      setStatus("模型推理失败，已用模板倾听。", "warn");
      return replyBubble.textContent;
    }
  }

  async function handleSend() {
    if (busy) return;
    const text = (el.input.value || "").trim();
    if (!text) return;
    el.input.value = "";
    el.send.disabled = true;
    appendMsg("user", text);

    if (detectCrisis(text)) {
      appendMsg("bot", crisisReply(), { crisis: true });
      setStatus("已显示危机支持信息。请优先联系热线。", "crisis");
      // Still allow WebLLM path to add empathy after, but crisis always first
      if (mode === "webllm" && webllmEngine) {
        // already showed crisis; skip duplicate model call for safety brevity
      }
      return;
    }

    setBusy(true);
    try {
      if (mode === "webllm") {
        setStatus("本地模型思考中…请稍候", "load");
        await webllmReply(text);
        setStatus("本地小模型 · 本机推理 · 已回复", "ok");
      } else {
        setStatus("正在听…", "load");
        await new Promise((r) => setTimeout(r, 280 + Math.random() * 220));
        appendMsg("bot", ruleReply(text));
        setStatus("模板倾听 · 完全离线 · 已接住", "ok");
      }
    } finally {
      setBusy(false);
      if (el.input) {
        el.input.disabled = false;
        el.input.focus();
      }
    }
  }

  function syncModeButtons() {
    if (el.modeRule) {
      el.modeRule.classList.toggle("is-on", mode === "rule");
      el.modeRule.setAttribute("aria-pressed", mode === "rule" ? "true" : "false");
    }
    if (el.modeLlm) {
      el.modeLlm.classList.toggle("is-on", mode === "webllm");
      el.modeLlm.setAttribute("aria-pressed", mode === "webllm" ? "true" : "false");
    }
  }

  function clearChat() {
    webllmMessages = [{ role: "system", content: SYSTEM_PROMPT }];
    resetCompanionSession();
    el.log.innerHTML = "";
    appendMsg("bot", GREETING);
    setBusy(false);
    setStatus(
      mode === "webllm" ? "本地小模型 · 对话已清空，可以重新说" : "模板倾听 · 对话已清空，可以重新说",
      "ok"
    );
  }

  function wire() {
    el.section = document.getElementById("companion");
    el.log = document.getElementById("companionLog");
    el.input = document.getElementById("companionInput");
    el.send = document.getElementById("btnCompanionSend");
    el.status = document.getElementById("companionStatus");
    el.modeRule = document.getElementById("btnModeRule");
    el.modeLlm = document.getElementById("btnModeWebllm");
    el.llmProgress = document.getElementById("companionLlmProgress");
    el.clear = document.getElementById("btnCompanionClear");
    if (!el.log || !el.input || !el.send) return;

    appendMsg("bot", GREETING);
    setStatus("模板倾听 · 完全离线 · 无 API Key · 随时可写", "ok");
    syncModeButtons();
    if (el.log) el.log.classList.remove("is-empty");
    const emptyHint = document.getElementById("companionEmpty");
    if (emptyHint) emptyHint.hidden = true;

    el.send.addEventListener("click", () => handleSend());
    el.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });
    el.input.addEventListener("input", () => {
      el.send.disabled = busy || !el.input.value.trim();
    });
    el.send.disabled = true;

    if (el.clear) el.clear.addEventListener("click", clearChat);

    if (el.modeRule) {
      el.modeRule.addEventListener("click", () => {
        mode = "rule";
        syncModeButtons();
        setStatus("已切换：模板倾听（离线、即时）。", "ok");
        if (el.llmProgress) el.llmProgress.hidden = true;
      });
    }

    if (el.modeLlm) {
      el.modeLlm.addEventListener("click", async () => {
        if (webllmLoading) return;
        setStatus("检查 WebGPU 并准备本地模型…", "load");
        try {
          await ensureWebLLM();
          mode = "webllm";
          syncModeButtons();
          appendMsg(
            "bot",
            "已切换到本地小模型（Qwen2.5-0.5B，本机 WebGPU）。仍请记住：我是倾听者，不是心理医生。危机时请打热线。"
          );
        } catch (_) {
          mode = "rule";
          syncModeButtons();
        }
      });
    }

    // Starter chips
    const starters = document.getElementById("companionStarters");
    if (starters) {
      starters.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-starter]");
        if (!btn) return;
        el.input.value = btn.getAttribute("data-starter") || "";
        el.send.disabled = !el.input.value.trim();
        el.input.focus();
      });
    }

    // Probe WebGPU quietly for button hint
    hasWebGPU().then((ok) => {
      if (el.modeLlm) {
        if (!ok) {
          el.modeLlm.title =
            "需要 Chrome/Edge 等支持 WebGPU 的浏览器；当前不可用，将回退模板倾听";
          el.modeLlm.dataset.available = "0";
        } else {
          el.modeLlm.title = "可选：下载小模型到本机，用 WebGPU 推理（无 API Key）";
          el.modeLlm.dataset.available = "1";
        }
      }
    });
  }

  window.VentCompanion = {
    ruleReply,
    extractKeywords,
    resetSession: resetCompanionSession,
    getTheme: () => sessionTheme,
    getLastReplies: () => lastReplies.slice(),
    getKnownKeys: () => knownKeys.slice(),
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
