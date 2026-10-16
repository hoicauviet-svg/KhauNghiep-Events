// Shared by the editor (index.html) and the import page (import.html).
window.KN = (() => {
  "use strict";

  const LIMITS = { merit: [1, 6], karma: [5, 45] };
  const SHAPES = ["person", "dog", "bird"];
  const SETTINGS_KEY = "kn-editor-settings";
  const DEFAULT_SETTINGS = { owner: "hoicauviet-svg", repo: "KhauNghiep-Events", branch: "main", token: "" };

  const settings = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
      else if (key === "value") el.value = value;
      else el.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children.flat()) if (child != null) el.append(child);
    return el;
  }

  // ---------- Encoding ----------
  const serialize = (value) => JSON.stringify(value, null, 2) + "\n";
  const clone = (value) => JSON.parse(JSON.stringify(value));
  function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }
  function fromBase64(b64) {
    const binary = atob(b64.replace(/\n/g, ""));
    return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  }

  // ---------- GitHub ----------
  function api(path, options = {}) {
    return fetch(`https://api.github.com/repos/${settings.owner}/${settings.repo}/${path}`, {
      ...options,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${settings.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(options.headers || {}),
      },
    }).then(async (res) => {
      if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.json().catch(() => ({}))).message || res.statusText}`);
      return res.json();
    });
  }
  const getFile = (name) => api(`contents/${name}?ref=${encodeURIComponent(settings.branch)}&t=${Date.now()}`);
  const putFile = (name, text, sha, message) =>
    api(`contents/${name}`, {
      method: "PUT",
      body: JSON.stringify({ message, content: toBase64(text), sha, branch: settings.branch }),
    });

  // Latest scenario: from GitHub when a token is set, otherwise the copy served by this website.
  async function loadCurrent() {
    if (settings.token) {
      const file = await getFile("events.json");
      return { data: normalize(JSON.parse(fromBase64(file.content))), sha: file.sha, source: "github" };
    }
    const res = await fetch(`events.json?t=${Date.now()}`);
    if (!res.ok) throw new Error(`Không tải được events.json (${res.status}).`);
    return { data: normalize(await res.json()), sha: null, source: "web" };
  }

  // Commits events.json, then bumps manifest.json so the game knows to download it.
  async function saveEvents(data, sha, message) {
    const manifestFile = await getFile("manifest.json");
    const manifest = JSON.parse(fromBase64(manifestFile.content));
    const version = (manifest.version || 0) + 1;
    const saved = await putFile("events.json", serialize(data), sha, `${message} v${version}`);
    manifest.version = version;
    manifest.updatedAt = new Date().toISOString();
    await putFile("manifest.json", serialize(manifest), manifestFile.sha, `Manifest v${version}`);
    return { version, sha: saved.content.sha };
  }

  // ---------- Data ----------
  function normalize(data) {
    data.characters ||= [];
    data.actions ||= [];
    data.stages ||= [];
    data.randomPool ||= [];
    data.rules ||= {};
    for (const stage of data.stages) stage.events ||= [];
    for (const event of allEvents(data)) normalizeEvent(event);
    return data;
  }
  function normalizeEvent(event) {
    event.choices ||= [];
    for (const choice of event.choices) choice.steps ||= [];
    return event;
  }
  const allEvents = (data) => [...data.stages.flatMap((s) => s.events || []), ...data.randomPool];

  function validate(data) {
    const problems = [];
    const charIds = new Set();
    for (const c of data.characters) {
      if (!c.id) problems.push({ where: "Nhân vật", msg: `"${c.name || "?"}" chưa có id.` });
      else if (charIds.has(c.id)) problems.push({ where: "Nhân vật", msg: `Trùng id "${c.id}".` });
      charIds.add(c.id);
      if (!c.name) problems.push({ where: "Nhân vật", msg: `"${c.id}" chưa có tên.` });
      if (!SHAPES.includes(c.shape)) problems.push({ where: "Nhân vật", msg: `"${c.id}" có hình "${c.shape}" không hợp lệ (person, dog, bird).` });
    }
    const actions = new Map(data.actions.map((a) => [a.id, a.who]));
    const titles = new Map();
    const check = (event, where, key) => {
      const add = (msg) => problems.push({ where, msg, key });
      if (!event.title) add("Thiếu tiêu đề.");
      else titles.set(event.title, (titles.get(event.title) || 0) + 1);
      if (!charIds.has(event.actor)) add(`Nhân vật "${event.actor}" không có trong danh sách.`);
      if (!event.prompt) add("Thiếu câu mở đầu.");
      if (!event.choices.length) add("Chưa có lựa chọn nào.");
      event.choices.forEach((choice, i) => {
        const tag = `Lựa chọn ${i + 1}`;
        if (!choice.text) add(`${tag}: thiếu câu chọn.`);
        if (!choice.verdict) add(`${tag}: thiếu lời phán.`);
        for (const field of ["merit", "karma"]) {
          const [lo, hi] = LIMITS[field];
          const v = choice[field];
          if (!Number.isInteger(v) || v < lo || v > hi) add(`${tag}: ${field === "merit" ? "công đức" : "khẩu nghiệp"} phải từ ${lo} đến ${hi}.`);
        }
        choice.steps.forEach((step, j) => {
          if (!actions.has(step.do)) add(`${tag}, bước ${j + 1}: động tác "${step.do}" không tồn tại.`);
          else if (actions.get(step.do) !== step.who) add(`${tag}, bước ${j + 1}: "${step.do}" là động tác của ${actions.get(step.do) === "monk" ? "sư" : "khách"}.`);
        });
      });
    };
    data.stages.forEach((stage, s) => {
      if (!stage.title) problems.push({ where: `Màn ${s + 1}`, msg: "Thiếu tên màn.", key: `stage:${s}` });
      stage.events.forEach((e, i) => check(e, `Màn ${s + 1} · ${e.title || "cảnh " + (i + 1)}`, `stage:${s}:${i}`));
    });
    data.randomPool.forEach((e, i) => check(e, `Kho random · ${e.title || "cảnh " + (i + 1)}`, `pool:${i}`));
    for (const [title, count] of titles) if (count > 1) problems.push({ where: "Toàn bộ", msg: `Tiêu đề "${title}" bị trùng ${count} lần.` });
    return problems;
  }

  return {
    LIMITS, SHAPES, settings, saveSettings, h, serialize, clone,
    getFile, putFile, fromBase64, loadCurrent, saveEvents,
    normalize, normalizeEvent, allEvents, validate,
  };
})();
