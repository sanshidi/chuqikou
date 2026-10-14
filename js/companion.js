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

  /* —— Emotion buckets → template replies —— */
  const BUCKETS = [
    {
      id: "anger",
      re: /怒|气炸|生气|愤怒|烦死|受够|忍无可忍|火大|窝火|憋屈|恨|想砸|想骂/,
      replies: [
        "听得出来，这股火很大，堵在胸口很久了。你愿意多说一点，是什么把你推到这一步的吗？",
        "被气到、觉得不公平，是很真实的感受。我在这儿听着。此刻最想对对方说、却没说出口的一句是什么？",
        "怒气常常在保护你不被继续伤害。先不用逼自己冷静——你愿意把最堵的那一句倒出来吗？",
      ],
    },
    {
      id: "fatigue",
      re: /累|疲惫|撑不住|没力气|崩溃|透支|倦|睡不好|失眠|心力交瘁/,
      replies: [
        "听起来你已经撑了很久，身体和心都在喊停。最近是哪一块最耗你？",
        "累到说不出话也很常见。不用一次讲完——你现在最需要的，是休息、被听见，还是有人陪着不说话？",
        "疲惫有时是长期紧绷的信号。你愿意描述一下「累」具体落在哪里吗——脑子、胸口，还是整个人？",
      ],
    },
    {
      id: "anxiety",
      re: /焦虑|紧张|害怕|慌|担心|不安|心悸|坐立不安|恐惧|怕/,
      replies: [
        "焦虑让人一直悬着，很消耗。你现在最担心会发生的那件事，能说说吗？",
        "害怕被看见时，身体也会跟着紧。我在听。若只选一件，「此刻最揪心的」是哪件？",
        "不安常常指向「失控感」。你愿意把脑海里转得最快的那个念头写下来吗？写出来有时会轻一点。",
      ],
    },
    {
      id: "sad",
      re: /难过|伤心|委屈|哭|失落|心酸|心痛|难受|郁闷|低落|绝望/,
      replies: [
        "听起来心里很沉，委屈和难受都值得被看见。发生了什么，让你这么难受？",
        "难过的时候，不必马上振作。我陪你待一会儿。你希望被怎样对待——听、抱抱，还是静静坐着？",
        "眼泪和沉默都是在说话。若你愿意，把最酸的那一句交给我也好。",
      ],
    },
    {
      id: "lonely",
      re: /孤独|寂寞|没人懂|一个人|被忽视|没人听|没人在意|孤单/,
      replies: [
        "感到孤单、觉得没人懂，是很沉的体验。此刻有我在听。你最希望有人懂的是哪一部分？",
        "一个人扛着的时候，世界会显得特别大。你愿意说说，今天是什么让孤独感突然变重了？",
        "被忽视的感觉很伤。你不需要把一切讲完美——随便从哪一句开始都行。",
      ],
    },
    {
      id: "shame",
      re: /羞耻|丢脸|没用|废物|失败|讨厌自己|自我厌恶|愧疚|内疚|对不起自己/,
      replies: [
        "对自己苛刻的时候，世界会变得很小。你不是「废物」——你是一个正在难受的人。愿意说说是什么触发了这句自我攻击吗？",
        "羞耻感常让人想躲起来。我不会评判你。若只说一件「我其实也……」，你会选哪件？",
        "失败感和讨厌自己，常常叠在疲惫上面。你愿意把对自己说的那句最狠的话，换成一句你会对朋友说的话吗？",
      ],
    },
    {
      id: "work",
      re: /工作|上班|老板|同事|加班|裁员|KPI|压力大|职场/,
      replies: [
        "职场的压榨感很容易把人掏空。今天最让你喘不过气的，是人、事，还是那种「永远做不完」的感觉？",
        "工作压力不只是「忙」，常常还有不被看见。你最想被同事或领导听到的一句是什么？",
        "听起来工作把你挤得很扁。先把情绪放这儿——你更想吐槽具体的事，还是那种整体的无力感？",
      ],
    },
    {
      id: "family",
      re: /家人|父母|爸爸|妈妈|亲戚|家里|原生家庭|催婚|比较/,
      replies: [
        "和家人的纠缠常常又爱又累。你愿意说说，最近哪一句或哪件事最刺你？",
        "原生家庭的旧伤，有时会在小事上突然炸开。我在听。你现在最需要的是边界，还是被理解？",
        "家里的期待可以很重。把「他们要的」和「你要的」分开说，也许会清晰一点——你更想从哪边开始？",
      ],
    },
    {
      id: "relation",
      re: /分手|恋爱|伴侣|对象|吵架|冷暴力|嫌弃|背叛|朋友|关系/,
      replies: [
        "关系里的伤口特别磨人。你现在的感受更靠近委屈、愤怒，还是失落？",
        "被冷落或争吵之后，脑子会反复回放。愿意把最卡的那一幕讲给我听吗？",
        "亲密关系里的痛，不需要马上「想开」。我先陪你待着。你最想被对方看见的是什么？",
      ],
    },
  ];

  const GENERIC = [
    "我在听。你刚才说的这些，哪一句是你最想被接住的？",
    "谢谢你愿意写下来。继续说也行，停一停也行——你现在更想怎样？",
    "听起来心里有事堵着。不用组织得很完美，想到什么就说什么。",
    "我接住了。若用一个词形容此刻的心情，你会选哪个？",
    "你已经迈出了开口这一步。还有哪一块，是你一直没对别人说过的？",
  ];

  const FOLLOWUPS = [
    "嗯，我听见了。还有呢？",
    "这一块听起来特别重。要不要再展开一点？",
    "你愿意的话，可以说说身体现在什么感觉——紧、空，还是麻木？",
    "如果可以对自己温柔一句，你会说什么？",
  ];

  const GREETING =
    "你好，我是树洞伙伴——一位倾听者，不是心理医生。\n" +
    "你可以随便倒情绪，内容只在本机，不会上传。\n" +
    "若你正经历危机或有伤害自己的念头，请优先联系真人专业支持（见下方热线）。\n" +
    "今天想从哪儿说起？";

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
      "老板", "同事", "加班", "裁员", "KPI", "绩效", "开会", "客户", "甲方",
      "父母", "妈妈", "爸爸", "亲戚", "催婚", "原生家庭",
      "对象", "伴侣", "分手", "冷暴力", "吵架", "背叛", "朋友",
      "房租", "房贷", "工资", "负债", "失业",
      "失眠", "睡不好", "头疼", "胸口", "心慌",
      "考试", "论文", "导师", "学校", "实习",
      "微信", "电话", "消息", "已读",
      "阴阳怪气", "甩锅", "点名", "羞辱",
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

    // Sort by score desc, then prefer shorter concrete (2–4) among similar scores
    scored.sort((a, b) => b.score - a.score || a.k.length - b.k.length);

    const out = [];
    for (const { k } of scored) {
      // Drop if this key is a broken fragment of an already-chosen longer key
      // OR if a chosen key is a lexicon word contained in this key (prefer lexicon)
      let skip = false;
      for (const u of out) {
        if (u === k) {
          skip = true;
          break;
        }
        // If both overlap heavily, keep higher-scored (already ordered)
        if (u.includes(k) && u.length - k.length <= 2) {
          skip = true;
          break;
        }
        if (k.includes(u) && LEX.includes(u)) {
          // keep lexicon u; skip longer wrapper unless wrapper is also high-value clause
          if (k.length > u.length + 4) {
            /* allow both */
          } else if (!LEX.includes(k) && !EMO.includes(k)) {
            skip = true;
            break;
          }
        }
      }
      if (skip) continue;
      out.push(k);
      if (out.length >= 5) break;
    }

    // Ensure lexicon hits that appeared in text are represented even after cap
    for (const w of LEX) {
      if (t.includes(w) && !out.includes(w)) {
        // replace last non-lex if needed
        const idx = out.findIndex((x) => !LEX.includes(x) && !EMO.includes(x));
        if (out.length < 5) out.push(w);
        else if (idx >= 0) out[idx] = w;
        else if (!out.includes(w)) {
          out[out.length - 1] = w;
        }
      }
    }
    // Same for EMO
    for (const w of EMO) {
      if (t.includes(w) && !out.includes(w) && out.length < 5) out.push(w);
    }

    return out;
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
    if (show.length === 1) {
      return "你提到了「" + show[0] + "」";
    }
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
    const fresh = candidates.filter((c) => !recent.includes(c));
    const pool = fresh.length ? fresh : candidates;
    return pick(pool);
  }

  function commitReply(reply) {
    lastReplies.push(reply);
    if (lastReplies.length > 16) lastReplies = lastReplies.slice(-16);
    turnCount += 1;
    return reply;
  }

  function buildReflective(text, keys, bucket) {
    const reflect = reflectClause(keys);
    const theme = sessionTheme;
    const key0 = keys[0] || "";
    const key1 = keys[1] || "";

    // Progressive: after several turns on same theme, deepen
    const deepen =
      theme &&
      bucket &&
      theme === bucket.id &&
      turnCount >= 2 &&
      Math.random() < 0.55;

    const openers = [];
    if (reflect) {
      openers.push(
        reflect + "——听起来这件事在你心里占了很大一块。",
        reflect + "。我接住了。",
        reflect + "，这话里压着不少力气。",
        "关于「" + key0 + "」，我听见了。"
      );
      if (key1) {
        openers.push(
          "「" + key0 + "」和「" + key1 + "」叠在一起，确实容易把人压扁。"
        );
      }
    }

    const middles = [];
    if (bucket) {
      if (bucket.id === "anger") {
        middles.push(
          "这股火不是无来由的。",
          "被气到、觉得不公平，是很真实的感受。",
          "怒气常常在保护你不被继续伤害。"
        );
      } else if (bucket.id === "fatigue") {
        middles.push(
          "听起来你已经撑了很久。",
          "累到说不出话也很常见。",
          "疲惫有时是长期紧绷的信号。"
        );
      } else if (bucket.id === "anxiety") {
        middles.push(
          "焦虑让人一直悬着，很消耗。",
          "害怕被看见时，身体也会跟着紧。",
          "不安常常指向失控感。"
        );
      } else if (bucket.id === "sad") {
        middles.push(
          "心里很沉的时候，委屈也值得被看见。",
          "难过的时候，不必马上振作。",
          "眼泪和沉默都是在说话。"
        );
      } else if (bucket.id === "lonely") {
        middles.push(
          "感到孤单、觉得没人懂，是很沉的体验。",
          "一个人扛着的时候，世界会显得特别大。"
        );
      } else if (bucket.id === "shame") {
        middles.push(
          "对自己苛刻的时候，世界会变得很小。",
          "羞耻感常让人想躲起来——我不会评判你。"
        );
      } else if (bucket.id === "work") {
        middles.push(
          "职场的压榨感很容易把人掏空。",
          "工作压力不只是忙，常常还有不被看见。"
        );
      } else if (bucket.id === "family") {
        middles.push(
          "和家人的纠缠常常又爱又累。",
          "家里的期待可以很重。"
        );
      } else if (bucket.id === "relation") {
        middles.push(
          "关系里的伤口特别磨人。",
          "被冷落或争吵之后，脑子会反复回放。"
        );
      }
    } else {
      middles.push(
        "听起来心里有事堵着。",
        "谢谢你愿意写下来。",
        "我在听。"
      );
    }

    const questions = [];
    if (key0) {
      questions.push(
        "关于「" + key0 + "」，此刻最堵的那一句是什么？",
        "「" + key0 + "」这件事，你最想对谁说一句却还没说出口？",
        "若只盯着「" + key0 + "」，你现在身体哪里最紧——胸口、太阳穴，还是胃？",
        "「" + key0 + "」让你最难受的，是不公平，还是无力感？"
      );
      if (key1) {
        questions.push(
          "「" + key0 + "」和「" + key1 + "」里，哪一块更想先倒出来？"
        );
      }
    }
    if (deepen && knownKeys.length) {
      const earlier = knownKeys.filter((k) => !keys.includes(k)).slice(-2);
      if (earlier.length) {
        questions.push(
          "你前面也提到过「" +
            earlier[0] +
            "」。它和现在说的「" +
            (key0 || "这件事") +
            "」是连在一起的吗？",
          "我们绕回「" +
            earlier[0] +
            "」看一眼——今天又触到它了吗？"
        );
      }
      questions.push(
        "同一主题又回来了。若用一个动作形容这股感觉，你会选砸、撕，还是把气吐掉？",
        "已经说了几轮。你更想继续挖深一点，还是换个角度——比如身体现在什么感觉？"
      );
    }
    questions.push(
      "你愿意多说一点吗？",
      "此刻最想被接住的是哪一句？",
      "继续说也行，停一停也行——你现在更想怎样？"
    );

    const o = pickUnique(openers.length ? openers : ["我在听。"]);
    const mid = pickUnique(middles.length ? middles : ["我接住了。"]);
    const q = pickUnique(questions);

    // Always ensure at least one key appears in the final reply when available
    let reply = o + mid + q;
    if (keys.length) {
      const hasKey = keys.some((k) => reply.includes(k) || reply.includes("「" + k + "」"));
      if (!hasKey) {
        reply =
          "你说到「" +
          keys[0] +
          "」。" +
          mid +
          (key0
            ? "关于「" + key0 + "」，你还想补充哪一句？"
            : q);
      }
    }
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

    // Short text with keys still get reflection
    const reply = buildReflective(t, keys, bucket);
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
    if (el.send) el.send.disabled = v || !(el.input && el.input.value.trim());
    if (el.input) el.input.disabled = v && mode === "webllm";
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
        setStatus("本地模型思考中…", "load");
        await webllmReply(text);
        setStatus("本地小模型 · 本机推理", "ok");
      } else {
        // slight delay so it feels like a reply turn
        await new Promise((r) => setTimeout(r, 280 + Math.random() * 220));
        appendMsg("bot", ruleReply(text));
        setStatus("模板倾听 · 完全离线", "ok");
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
    setStatus(
      mode === "webllm" ? "本地小模型 · 对话已清空" : "模板倾听 · 对话已清空",
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
    setStatus("模板倾听 · 完全离线 · 无 API Key", "ok");
    syncModeButtons();

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
