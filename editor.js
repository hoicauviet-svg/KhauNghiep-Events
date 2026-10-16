(() => {
  "use strict";

  const LIMITS = { merit: [1, 6], karma: [5, 45] };
  const SETTINGS_KEY = "kn-editor-settings";
  const DEFAULT_SETTINGS = { owner: "hoicauviet-svg", repo: "KhauNghiep-Events", branch: "main", token: "" };

  let data = null;
  let loadedSha = null;
  let dirty = false;
  let selection = { kind: "characters" };
  let settings = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };

  const $ = (id) => document.getElementById(id);
  const statusEl = $("status");

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

  function setStatus(text, kind = "") {
    statusEl.textContent = text;
    statusEl.className = "status " + kind;
  }
  function markDirty() {
    dirty = true;
    setStatus("Có thay đổi chưa lưu.", "dirty");
    renderSidebar();
  }

  // ---------- Encoding ----------
  const serialize = (value) => JSON.stringify(value, null, 2) + "\n";
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

  // ---------- Load ----------
  async function load() {
    if (dirty && !confirm("Bỏ các thay đổi chưa lưu?")) return;
    setStatus("Đang tải…");
    try {
      if (settings.token) {
        const file = await getFile("events.json");
        data = JSON.parse(fromBase64(file.content));
        loadedSha = file.sha;
        setStatus(`Đã tải từ GitHub (${settings.owner}/${settings.repo}@${settings.branch}).`);
      } else {
        const res = await fetch(`events.json?t=${Date.now()}`);
        if (!res.ok) throw new Error(`Không tải được events.json (${res.status}).`);
        data = await res.json();
        loadedSha = null;
        setStatus("Đã tải bản đang chạy trên web. Nhập token GitHub để lưu được.");
      }
      normalize();
      dirty = false;
      if (!isSelectionValid()) selection = { kind: "characters" };
      render();
    } catch (err) {
      setStatus(err.message, "error");
    }
  }
  function normalize() {
    data.characters ||= [];
    data.actions ||= [];
    data.stages ||= [];
    data.randomPool ||= [];
    data.rules ||= {};
    for (const event of allEvents()) {
      event.choices ||= [];
      for (const choice of event.choices) choice.steps ||= [];
    }
  }
  function allEvents() {
    return [...data.stages.flatMap((s) => s.events || []), ...data.randomPool];
  }

  // ---------- Validation ----------
  function validate() {
    const problems = [];
    const charIds = new Set();
    for (const c of data.characters) {
      if (!c.id) problems.push({ where: "Nhân vật", msg: `"${c.name || "?"}" chưa có id.` });
      else if (charIds.has(c.id)) problems.push({ where: "Nhân vật", msg: `Trùng id "${c.id}".` });
      charIds.add(c.id);
      if (!c.name) problems.push({ where: "Nhân vật", msg: `"${c.id}" chưa có tên.` });
      if (!["person", "dog", "bird"].includes(c.shape)) problems.push({ where: "Nhân vật", msg: `"${c.id}" có hình "${c.shape}" không hợp lệ.` });
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
      (stage.events || []).forEach((e, i) => check(e, `Màn ${s + 1} · ${e.title || "cảnh " + (i + 1)}`, `stage:${s}:${i}`));
    });
    data.randomPool.forEach((e, i) => check(e, `Kho random · ${e.title || "cảnh " + (i + 1)}`, `pool:${i}`));
    for (const [title, count] of titles) if (count > 1) problems.push({ where: "Toàn bộ", msg: `Tiêu đề "${title}" bị trùng ${count} lần.` });
    return problems;
  }
  function showReport(problems, title) {
    $("report-title").textContent = title;
    const list = $("report-list");
    list.replaceChildren(
      ...(problems.length
        ? problems.map((p) => h("li", { class: "bad" }, `${p.where}: ${p.msg}`))
        : [h("li", { class: "ok" }, `Không có lỗi. ${data.stages.length} màn cố định, ${data.randomPool.length} tình huống random.`)])
    );
    $("report").showModal();
  }

  // ---------- Save ----------
  async function save() {
    if (!settings.token) { openSettings(); return; }
    const problems = validate();
    if (problems.length) { showReport(problems, "Chưa lưu được, còn lỗi"); return; }
    setStatus("Đang lưu…");
    try {
      const current = await getFile("events.json");
      if (loadedSha && current.sha !== loadedSha &&
          !confirm("Kịch bản trên GitHub đã bị sửa từ lúc bạn tải. Vẫn ghi đè?")) {
        setStatus("Đã huỷ lưu.", "dirty");
        return;
      }
      const manifestFile = await getFile("manifest.json");
      const manifest = JSON.parse(fromBase64(manifestFile.content));
      const version = (manifest.version || 0) + 1;
      const saved = await putFile("events.json", serialize(data), current.sha, `Cập nhật kịch bản v${version}`);
      loadedSha = saved.content.sha;
      manifest.version = version;
      manifest.updatedAt = new Date().toISOString();
      await putFile("manifest.json", serialize(manifest), manifestFile.sha, `Manifest v${version}`);
      dirty = false;
      setStatus(`Đã lưu bản v${version}. Hostinger sẽ tự cập nhật sau ít phút.`);
      renderSidebar();
    } catch (err) {
      setStatus(err.message, "error");
    }
  }

  async function importFile(file) {
    if (!file) return;
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch (err) {
      showMessage("Không nhập được", [`File "${file.name}" không phải JSON hợp lệ: ${err.message}`]);
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || (!parsed.stages && !parsed.randomPool)) {
      showMessage("Không nhập được", [`File "${file.name}" không có "stages" hoặc "randomPool". Đây không phải file kịch bản.`]);
      return;
    }
    if (dirty && !confirm("Nhập file sẽ thay toàn bộ kịch bản đang sửa và bỏ các thay đổi chưa lưu. Tiếp tục?")) return;
    // Keep the action list when the file has none, since it only describes what the game code can play.
    if (!parsed.actions?.length && data?.actions?.length) parsed.actions = data.actions;
    data = parsed;
    normalize();
    selection = { kind: "characters" };
    dirty = true;
    render();
    const problems = validate();
    setStatus(`Đã nhập "${file.name}". Kiểm tra rồi bấm Lưu lên GitHub.`, "dirty");
    showReport(problems, problems.length ? `Đã nhập, còn ${problems.length} lỗi cần sửa trước khi lưu` : "Đã nhập file");
  }
  function showMessage(title, lines) {
    $("report-title").textContent = title;
    $("report-list").replaceChildren(...lines.map((line) => h("li", { class: "bad" }, line)));
    $("report").showModal();
  }

  function download() {
    const url = URL.createObjectURL(new Blob([serialize(data)], { type: "application/json" }));
    h("a", { href: url, download: "events.json" }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- Settings ----------
  function openSettings() {
    const form = $("settings").querySelector("form");
    for (const key of ["owner", "repo", "branch", "token"]) form.elements[key].value = settings[key] || "";
    $("settings").showModal();
  }
  $("settings").addEventListener("close", () => {
    const action = $("settings").returnValue;
    const form = $("settings").querySelector("form");
    if (action === "save") {
      for (const key of ["owner", "repo", "branch", "token"]) settings[key] = form.elements[key].value.trim();
    } else if (action === "clear") {
      settings.token = "";
    } else return;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    setStatus(settings.token ? "Đã lưu cài đặt. Bấm Tải lại để lấy bản mới nhất từ GitHub." : "Đã xoá token.");
  });

  // ---------- Selection helpers ----------
  function isSelectionValid() {
    if (selection.kind === "stage") return !!data.stages[selection.s];
    if (selection.kind === "event") return !!eventList(selection)?.[selection.i];
    return true;
  }
  function eventList(sel) {
    return sel.pool ? data.randomPool : data.stages[sel.s]?.events;
  }
  function select(sel) {
    selection = sel;
    render();
    window.scrollTo(0, 0);
  }

  // ---------- Templates ----------
  const newChoice = () => ({ text: "", steps: [], merit: 3, karma: 15, reply: "", verdict: "", thought: "" });
  const newEvent = () => ({
    title: "TÌNH HUỐNG MỚI",
    actor: data.characters[0]?.id || "",
    prompt: "",
    choices: [newChoice(), newChoice(), newChoice()],
  });

  // ---------- Sidebar ----------
  function renderSidebar() {
    const errorKeys = new Set(validate().map((p) => p.key).filter(Boolean));
    const isActive = (sel) => JSON.stringify(sel) === JSON.stringify(selection);
    const item = (label, sel, cls, errKey) =>
      h("button", { class: `nav-item ${cls} ${isActive(sel) ? "active" : ""} ${errorKeys.has(errKey) ? "has-error" : ""}`, onclick: () => select(sel) }, label);

    const groups = [
      h("div", { class: "nav-group" },
        item(`Nhân vật (${data.characters.length})`, { kind: "characters" }, "nav-stage"),
        item(`Động tác (${data.actions.length})`, { kind: "actions" }, "nav-stage")),
    ];
    const stages = h("div", { class: "nav-group" },
      h("div", { class: "nav-head" }, `Màn cố định (${data.stages.length})`,
        h("button", { class: "small", onclick: () => { data.stages.push({ title: "MÀN MỚI", events: [] }); markDirty(); select({ kind: "stage", s: data.stages.length - 1 }); } }, "+ Màn")));
    data.stages.forEach((stage, s) => {
      stages.append(item(`${s + 1}. ${stage.title}`, { kind: "stage", s }, "nav-stage", `stage:${s}`));
      (stage.events || []).forEach((e, i) => stages.append(item(e.title || "(chưa đặt tên)", { kind: "event", s, i }, "nav-event", `stage:${s}:${i}`)));
    });
    groups.push(stages);
    const pool = h("div", { class: "nav-group" },
      h("div", { class: "nav-head" }, `Kho random (${data.randomPool.length})`,
        h("button", { class: "small", onclick: () => { data.randomPool.push(newEvent()); markDirty(); select({ kind: "event", pool: true, i: data.randomPool.length - 1 }); } }, "+ Tình huống")));
    data.randomPool.forEach((e, i) => pool.append(item(e.title || "(chưa đặt tên)", { kind: "event", pool: true, i }, "nav-event", `pool:${i}`)));
    groups.push(pool);
    $("sidebar").replaceChildren(...groups);
  }

  // ---------- Editors ----------
  function bindInput(obj, key, { number = false, multiline = false, rerenderNav = false } = {}) {
    const attrs = {
      value: obj[key] ?? "",
      oninput: (e) => {
        obj[key] = number ? parseInt(e.target.value, 10) : e.target.value;
        if (rerenderNav) markDirty();
        else { dirty = true; setStatus("Có thay đổi chưa lưu.", "dirty"); }
      },
      onchange: () => renderSidebar(),
    };
    if (number) return h("input", { type: "number", step: 1, ...attrs });
    return multiline ? h("textarea", attrs) : h("input", attrs);
  }
  const field = (label, control) => h("label", { class: "field" }, h("span", {}, label), control);

  function renderCharacters() {
    const rows = data.characters.map((c, i) =>
      h("tr", {},
        h("td", {}, bindInput(c, "id", { rerenderNav: true })),
        h("td", {}, bindInput(c, "name")),
        h("td", {}, h("select", { onchange: (e) => { c.shape = e.target.value; markDirty(); } },
          ...["person", "dog", "bird"].map((s) => h("option", { value: s, selected: c.shape === s }, { person: "Người", dog: "Chó", bird: "Chim" }[s])))),
        h("td", {}, h("input", { type: "color", value: c.color || "#888888", oninput: (e) => { c.color = e.target.value.toUpperCase(); markDirty(); }, onchange: () => render() })),
        h("td", {}, bindInput(c, "tag")),
        h("td", {}, h("span", { class: "swatch", style: `background:${c.color}` }, c.tag || "—")),
        h("td", {}, h("button", { class: "small danger", onclick: () => {
          const used = allEvents().filter((e) => e.actor === c.id).length;
          if (used && !confirm(`"${c.name}" đang dùng trong ${used} tình huống. Vẫn xoá?`)) return;
          data.characters.splice(i, 1); markDirty(); render();
        } }, "Xoá"))));
    return [
      h("h1", {}, "Nhân vật"),
      h("div", { class: "sub" }, "Mỗi tình huống gọi nhân vật theo id. Người vẽ bằng màu áo và chữ trên đầu."),
      h("table", { class: "chars" },
        h("tr", {}, ...["id", "Tên", "Hình", "Màu", "Chữ trên đầu", "Xem", ""].map((t) => h("th", {}, t))),
        ...rows),
      h("div", { class: "toolbar", style: "margin-top:12px" },
        h("button", { onclick: () => { data.characters.push({ id: `nhan_vat_${data.characters.length + 1}`, name: "Nhân Vật Mới", shape: "person", color: "#8B9872", tag: "MỚI" }); markDirty(); render(); } }, "+ Nhân vật")),
    ];
  }

  function renderActions() {
    return [
      h("h1", {}, "Động tác"),
      h("div", { class: "sub" }, "Danh sách này do code trong game quyết định. Thêm động tác mới cần cập nhật app, nên ở đây chỉ xem."),
      h("table", { class: "chars" },
        h("tr", {}, h("th", {}, "id"), h("th", {}, "Ai làm"), h("th", {}, "Mô tả")),
        ...data.actions.map((a) => h("tr", {}, h("td", {}, h("code", {}, a.id)), h("td", {}, a.who === "monk" ? "Sư" : "Khách"), h("td", {}, a.note || "")))),
    ];
  }

  function renderStage(s) {
    const stage = data.stages[s];
    return [
      h("h1", {}, `Màn ${s + 1}`),
      h("div", { class: "sub" }, `${(stage.events || []).length} tình huống. Phá đám xuất hiện đều trong 60 điểm farm đầu.`),
      field("Tên màn", bindInput(stage, "title", { rerenderNav: true })),
      h("div", { class: "toolbar" },
        h("button", { onclick: () => { stage.events.push(newEvent()); markDirty(); select({ kind: "event", s, i: stage.events.length - 1 }); } }, "+ Tình huống"),
        h("button", { disabled: s === 0, onclick: () => { [data.stages[s - 1], data.stages[s]] = [data.stages[s], data.stages[s - 1]]; markDirty(); select({ kind: "stage", s: s - 1 }); } }, "Lên"),
        h("button", { disabled: s === data.stages.length - 1, onclick: () => { [data.stages[s + 1], data.stages[s]] = [data.stages[s], data.stages[s + 1]]; markDirty(); select({ kind: "stage", s: s + 1 }); } }, "Xuống"),
        h("button", { class: "danger", onclick: () => {
          if (!confirm(`Xoá màn "${stage.title}" cùng ${stage.events.length} tình huống?`)) return;
          data.stages.splice(s, 1); markDirty(); select({ kind: "characters" });
        } }, "Xoá màn")),
    ];
  }

  function renderEvent(sel) {
    const list = eventList(sel);
    const event = list[sel.i];
    const place = sel.pool ? "Kho random" : `Màn ${sel.s + 1} · ${data.stages[sel.s].title}`;
    const move = (to) => { [list[sel.i], list[to]] = [list[to], list[sel.i]]; markDirty(); select({ ...sel, i: to }); };
    const moveTargets = [
      ...data.stages.map((st, s) => ({ label: `Màn ${s + 1}: ${st.title}`, value: `stage:${s}` })),
      { label: "Kho random", value: "pool" },
    ].filter((t) => t.value !== (sel.pool ? "pool" : `stage:${sel.s}`));

    return [
      h("h1", {}, event.title || "(chưa đặt tên)"),
      h("div", { class: "sub" }, place),
      h("div", { class: "toolbar" },
        h("button", { disabled: sel.i === 0, onclick: () => move(sel.i - 1) }, "Lên"),
        h("button", { disabled: sel.i === list.length - 1, onclick: () => move(sel.i + 1) }, "Xuống"),
        h("button", { onclick: () => { list.splice(sel.i + 1, 0, JSON.parse(JSON.stringify({ ...event, title: event.title + " (BẢN SAO)" }))); markDirty(); select({ ...sel, i: sel.i + 1 }); } }, "Nhân bản"),
        h("select", { style: "width:auto", onchange: (e) => {
          if (!e.target.value) return;
          const [kind, s] = e.target.value.split(":");
          list.splice(sel.i, 1);
          const target = kind === "pool" ? data.randomPool : data.stages[+s].events;
          target.push(event); markDirty();
          select(kind === "pool" ? { kind: "event", pool: true, i: target.length - 1 } : { kind: "event", s: +s, i: target.length - 1 });
        } }, h("option", { value: "" }, "Chuyển sang…"), ...moveTargets.map((t) => h("option", { value: t.value }, t.label))),
        h("button", { class: "danger", onclick: () => {
          if (!confirm(`Xoá "${event.title}"?`)) return;
          list.splice(sel.i, 1); markDirty();
          select(sel.pool ? { kind: "characters" } : { kind: "stage", s: sel.s });
        } }, "Xoá")),
      h("div", { class: "grid-2" },
        field("Tiêu đề", bindInput(event, "title", { rerenderNav: true })),
        field("Nhân vật", h("select", { onchange: (e) => { event.actor = e.target.value; markDirty(); } },
          ...(data.characters.some((c) => c.id === event.actor) ? [] : [h("option", { value: event.actor, selected: true }, `(không tồn tại: ${event.actor})`)]),
          ...data.characters.map((c) => h("option", { value: c.id, selected: c.id === event.actor }, `${c.name} (${c.id})`))))),
      field("Câu mở đầu của khách", bindInput(event, "prompt", { multiline: true })),
      ...event.choices.map((choice, i) => renderChoice(event, choice, i)),
      h("div", { class: "toolbar" }, h("button", { onclick: () => { event.choices.push(newChoice()); markDirty(); render(); } }, "+ Lựa chọn")),
    ];
  }

  function renderChoice(event, choice, i) {
    const actionsFor = (who) => data.actions.filter((a) => a.who === who);
    const stepRows = choice.steps.map((step, j) =>
      h("div", { class: "step" },
        h("select", { onchange: (e) => { step.who = e.target.value; step.do = actionsFor(step.who)[0]?.id || ""; markDirty(); render(); } },
          h("option", { value: "monk", selected: step.who === "monk" }, "Sư"),
          h("option", { value: "actor", selected: step.who === "actor" }, "Khách")),
        h("select", { onchange: (e) => { step.do = e.target.value; markDirty(); } },
          ...(actionsFor(step.who).some((a) => a.id === step.do) ? [] : [h("option", { value: step.do, selected: true }, `(sai: ${step.do})`)]),
          ...actionsFor(step.who).map((a) => h("option", { value: a.id, selected: a.id === step.do }, `${a.id} · ${a.note || ""}`))),
        h("button", { class: "small", disabled: j === 0, onclick: () => { [choice.steps[j - 1], choice.steps[j]] = [choice.steps[j], choice.steps[j - 1]]; markDirty(); render(); } }, "↑"),
        h("button", { class: "small", disabled: j === choice.steps.length - 1, onclick: () => { [choice.steps[j + 1], choice.steps[j]] = [choice.steps[j], choice.steps[j + 1]]; markDirty(); render(); } }, "↓"),
        h("button", { class: "small danger", onclick: () => { choice.steps.splice(j, 1); markDirty(); render(); } }, "Xoá")));

    return h("div", { class: "choice" },
      h("div", { class: "choice-head" },
        h("b", {}, `Lựa chọn ${i + 1}`),
        h("button", { class: "small danger", onclick: () => { event.choices.splice(i, 1); markDirty(); render(); } }, "Xoá lựa chọn")),
      h("div", { class: "grid-3 points" },
        field("Câu người chơi chọn", bindInput(choice, "text")),
        field(`Công đức (${LIMITS.merit.join("–")})`, Object.assign(bindInput(choice, "merit", { number: true }), { name: "merit", min: LIMITS.merit[0], max: LIMITS.merit[1] })),
        field(`Khẩu nghiệp (${LIMITS.karma.join("–")})`, Object.assign(bindInput(choice, "karma", { number: true }), { name: "karma", min: LIMITS.karma[0], max: LIMITS.karma[1] }))),
      field("Khách đáp lại (để trống nếu không có)", bindInput(choice, "reply")),
      field("Thánh phán", bindInput(choice, "verdict", { multiline: true })),
      field("Sư nghĩ thầm", bindInput(choice, "thought")),
      h("div", { class: "steps" },
        h("div", { class: "field" }, h("span", {}, "Hành động (chạy lần lượt)")),
        stepRows.length ? stepRows : h("div", { class: "empty" }, "Không có hành động, chỉ có lời thoại."),
        h("button", { class: "small", onclick: () => { choice.steps.push({ who: "monk", do: actionsFor("monk")[0]?.id || "" }); markDirty(); render(); } }, "+ Hành động")));
  }

  function render() {
    renderSidebar();
    let content;
    if (selection.kind === "actions") content = renderActions();
    else if (selection.kind === "stage") content = renderStage(selection.s);
    else if (selection.kind === "event") content = renderEvent(selection);
    else content = renderCharacters();
    $("editor").replaceChildren(...content);
  }

  // ---------- Wire up ----------
  $("btn-reload").onclick = load;
  $("btn-validate").onclick = () => showReport(validate(), "Kết quả kiểm tra");
  $("btn-download").onclick = download;
  $("btn-import").onclick = () => $("import-file").click();
  $("import-file").onchange = (e) => { importFile(e.target.files[0]); e.target.value = ""; };
  document.addEventListener("dragover", (e) => { if (e.dataTransfer?.types.includes("Files")) e.preventDefault(); });
  document.addEventListener("drop", (e) => {
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    importFile(e.dataTransfer.files[0]);
  });
  $("btn-settings").onclick = openSettings;
  $("btn-save").onclick = save;
  window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
  load();
})();
