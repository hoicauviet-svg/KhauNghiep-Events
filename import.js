(() => {
  "use strict";

  const { settings, h, serialize, clone } = KN;

  const $ = (id) => document.getElementById(id);
  const statusEl = $("status");

  let current = null;
  let incoming = null;
  let preview = null;

  function setStatus(text, kind = "") {
    statusEl.textContent = text;
    statusEl.className = "status " + kind;
  }

  // Key order differs between hand-written files and the saved scenario, so compare canonically.
  function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object")
      return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
    return JSON.stringify(value);
  }
  const same = (a, b) => canonical(a) === canonical(b);

  // ---------- Parse ----------
  // A file with actions or rules is a whole events.json and replaces everything; anything else is merged.
  function parseIncoming(text) {
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      return { problems: [{ where: "File", msg: `JSON sai cú pháp: ${err.message}` }] };
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      return { problems: [{ where: "File", msg: "File phải là một object có characters, stages hoặc randomPool." }] };

    const problems = [];
    for (const key of ["characters", "stages", "randomPool"])
      if (raw[key] != null && !Array.isArray(raw[key])) problems.push({ where: "File", msg: `"${key}" phải là một mảng.` });
    if (problems.length) return { problems };

    const full = Array.isArray(raw.actions) || (raw.rules != null && typeof raw.rules === "object");
    const file = {
      full,
      raw,
      characters: raw.characters || [],
      stages: (raw.stages || []).map((s) => ({ ...s, events: s.events || [] })),
      randomPool: raw.randomPool || [],
    };

    if (full) {
      if (!file.characters.length) problems.push({ where: "File", msg: "Kịch bản đầy đủ phải có ít nhất một nhân vật." });
      if (!file.stages.length) problems.push({ where: "File", msg: "Kịch bản đầy đủ phải có ít nhất một màn." });
    } else if (!file.characters.length && !file.randomPool.length && !file.stages.length) {
      problems.push({ where: "File", msg: "File không có nhân vật, màn hay tình huống nào." });
    }

    file.stages.forEach((s, i) => {
      if (!s.title) problems.push({ where: `Màn ${i + 1} trong file`, msg: "Thiếu tên màn." });
      if (!Array.isArray(s.events)) problems.push({ where: `Màn ${s.title || i + 1}`, msg: `"events" phải là một mảng.` });
    });
    if (problems.length) return { problems };

    const ids = new Set();
    for (const c of file.characters) {
      if (!c.id) problems.push({ where: "Nhân vật", msg: `"${c.name || "?"}" chưa có id.` });
      else if (ids.has(c.id)) problems.push({ where: "Nhân vật", msg: `File có hai nhân vật cùng id "${c.id}".` });
      ids.add(c.id);
    }
    const titles = new Set();
    for (const e of [...file.stages.flatMap((s) => s.events), ...file.randomPool]) {
      if (!e || typeof e !== "object") { problems.push({ where: "Tình huống", msg: "Có tình huống không phải object." }); continue; }
      if (!e.title) problems.push({ where: "Tình huống", msg: "Có tình huống thiếu tiêu đề." });
      else if (titles.has(e.title)) problems.push({ where: "Tình huống", msg: `File có hai tình huống cùng tiêu đề "${e.title}".` });
      titles.add(e.title);
      KN.normalizeEvent(e);
    }
    return problems.length ? { problems } : { file, problems };
  }

  const stageLabel = (data, s) => `Màn ${s + 1} · ${data.stages[s].title}`;
  function eventIndex(data) {
    const located = new Map();
    data.stages.forEach((stage, s) => stage.events.forEach((e, i) => located.set(e.title, { list: stage.events, i, where: stageLabel(data, s) })));
    data.randomPool.forEach((e, i) => located.set(e.title, { list: data.randomPool, i, where: "Kho random" }));
    return located;
  }

  // ---------- Replace ----------
  function replace(base, file) {
    const { raw } = file;
    const data = KN.normalize({
      ...clone(raw),
      characters: clone(file.characters),
      stages: clone(file.stages),
      randomPool: clone(file.randomPool),
      actions: clone(base.actions),
      rules: clone(raw.rules || base.rules),
    });
    if (raw.status == null && base.status != null) data.status = base.status;
    const changes = [];

    const oldChars = new Map(base.characters.map((c) => [c.id, c]));
    const newIds = new Set(data.characters.map((c) => c.id));
    for (const c of data.characters) {
      const old = oldChars.get(c.id);
      changes.push({ type: "Nhân vật", name: `${c.name || c.id} (${c.id})`, where: "", action: !old ? "add" : same(old, c) ? "same" : "update" });
    }
    for (const c of base.characters) if (!newIds.has(c.id)) changes.push({ type: "Nhân vật", name: `${c.name} (${c.id})`, where: "", action: "remove" });

    const oldStages = new Set(base.stages.map((s) => s.title));
    const newStages = new Set(data.stages.map((s) => s.title));
    data.stages.forEach((s, i) => { if (!oldStages.has(s.title)) changes.push({ type: "Màn", name: s.title, where: stageLabel(data, i), action: "add" }); });
    base.stages.forEach((s, i) => { if (!newStages.has(s.title)) changes.push({ type: "Màn", name: s.title, where: stageLabel(base, i), action: "remove" }); });

    const oldEvents = eventIndex(base);
    const newEvents = eventIndex(data);
    for (const [title, found] of newEvents) {
      const old = oldEvents.get(title);
      const action = !old ? "add" : same(old.list[old.i], found.list[found.i]) && old.where === found.where ? "same" : "update";
      changes.push({ type: "Tình huống", name: title, where: found.where, action });
    }
    for (const [title, old] of oldEvents) if (!newEvents.has(title)) changes.push({ type: "Tình huống", name: title, where: old.where, action: "remove" });

    return { data, changes };
  }

  // ---------- Merge ----------
  function merge(base, file) {
    const data = clone(base);
    const changes = [];

    for (const c of file.characters) {
      const i = data.characters.findIndex((x) => x.id === c.id);
      if (i < 0) {
        data.characters.push(clone(c));
        changes.push({ type: "Nhân vật", name: `${c.name || c.id} (${c.id})`, where: "", action: "add" });
      } else {
        const merged = { ...data.characters[i], ...clone(c) };
        changes.push({ type: "Nhân vật", name: `${merged.name} (${c.id})`, where: "", action: same(merged, data.characters[i]) ? "same" : "update" });
        data.characters[i] = merged;
      }
    }

    const located = eventIndex(data);
    const putEvent = (event, list, where) => {
      const found = located.get(event.title);
      if (found) {
        const action = same(event, found.list[found.i]) ? "same" : "update";
        found.list[found.i] = clone(event);
        changes.push({ type: "Tình huống", name: event.title, where: found.where, action });
      } else {
        list.push(clone(event));
        located.set(event.title, { list, i: list.length - 1, where });
        changes.push({ type: "Tình huống", name: event.title, where, action: "add" });
      }
    };

    for (const stage of file.stages) {
      let s = data.stages.findIndex((x) => x.title === stage.title);
      if (s < 0) {
        const { events, ...rest } = stage;
        data.stages.push({ ...clone(rest), events: [] });
        s = data.stages.length - 1;
        changes.push({ type: "Màn", name: stage.title, where: stageLabel(data, s), action: "add" });
      }
      for (const e of stage.events) putEvent(e, data.stages[s].events, stageLabel(data, s));
    }
    for (const e of file.randomPool) putEvent(e, data.randomPool, "Kho random");

    return { data, changes };
  }

  const build = (base, file) => (file.full ? replace(base, file) : merge(base, file));

  // ---------- Preview ----------
  const ACTION_TEXT = { add: "Thêm mới", update: "Cập nhật", same: "Không đổi", remove: "Xoá" };

  function check(text, name) {
    if (!current) { setStatus("Chưa tải được kịch bản hiện tại.", "error"); return; }
    const parsed = parseIncoming(text);
    incoming = parsed.file || null;
    preview = incoming ? build(current.data, incoming) : null;
    render([...parsed.problems, ...(preview ? KN.validate(preview.data) : [])], name);
  }

  function render(problems, name) {
    $("result").hidden = false;
    if (name) $("result-title").textContent = !incoming
      ? `"${name}"`
      : `"${name}" · ${incoming.full ? "kịch bản đầy đủ, thay toàn bộ" : "một phần kịch bản, gộp vào bản hiện tại"}`;
    const changes = preview ? preview.changes : [];
    const count = (a) => changes.filter((c) => c.action === a).length;
    const changed = count("add") + count("update") + count("remove");
    const ok = preview && !problems.length;

    $("summary").textContent = !preview
      ? "Không nhập được file này."
      : `${count("add")} thêm mới, ${count("update")} cập nhật, ${count("remove")} xoá, ${count("same")} không đổi.` +
        (problems.length ? ` Còn ${problems.length} lỗi, sửa file rồi tải lên lại.` : changed ? " Không có lỗi." : " Không có gì để lưu.");
    $("summary").className = ok ? "ok" : "bad";

    $("problems").replaceChildren(...problems.map((p) => h("li", { class: "bad" }, `${p.where}: ${p.msg}`)));
    const order = { remove: 0, add: 1, update: 2, same: 3 };
    $("changes").replaceChildren(
      ...[...changes].sort((a, b) => order[a.action] - order[b.action]).map((c) =>
        h("tr", { class: c.action }, h("td", {}, c.type), h("td", {}, c.name), h("td", {}, c.where), h("td", {}, ACTION_TEXT[c.action]))
      )
    );
    $("changes").closest("table").hidden = !changes.length;
    $("btn-apply").disabled = !ok || !changed;
    $("btn-download").disabled = !ok;
    $("result").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------- Apply ----------
  async function apply() {
    if (!settings.token) { openSettings(); return; }
    const removed = preview.changes.filter((c) => c.action === "remove").length;
    if (removed && !confirm(`Sẽ xoá ${removed} mục không có trong file. Tiếp tục lưu?`)) return;
    $("btn-apply").disabled = true;
    setStatus("Đang lưu…");
    try {
      // Rebuild on the newest copy so edits saved meanwhile are kept when merging.
      current = await KN.loadCurrent();
      const fresh = build(current.data, incoming);
      const problems = KN.validate(fresh.data);
      preview = fresh;
      if (problems.length) {
        render(problems);
        setStatus("Kịch bản trên GitHub vừa đổi và bản kết quả có lỗi. Chưa lưu.", "error");
        return;
      }
      const saved = await KN.saveEvents(fresh.data, current.sha, incoming.full ? "Nhập kịch bản đầy đủ" : "Gộp kịch bản");
      current = { data: fresh.data, sha: saved.sha, source: "github" };
      setStatus(`Đã lưu bản v${saved.version}. Hostinger sẽ tự cập nhật sau ít phút.`);
    } catch (err) {
      setStatus(err.message, "error");
      $("btn-apply").disabled = false;
    }
  }

  function downloadJson(data) {
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
    KN.saveSettings();
    loadCurrent();
  });

  // ---------- Input ----------
  async function readFile(file) {
    if (!file) return;
    check(await file.text(), file.name);
  }

  const dropzone = $("dropzone");
  $("file").onchange = (e) => { readFile(e.target.files[0]); e.target.value = ""; };
  dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("over"); });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("over"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("over");
    readFile(e.dataTransfer.files[0]);
  });

  $("btn-current").onclick = () => current && downloadJson(current.data);
  $("btn-apply").onclick = apply;
  $("btn-download").onclick = () => downloadJson(preview.data);
  $("btn-settings").onclick = openSettings;

  async function loadCurrent() {
    setStatus("Đang tải…");
    try {
      current = await KN.loadCurrent();
      setStatus(current.source === "github"
        ? `Bản hiện tại lấy từ GitHub (${settings.owner}/${settings.repo}@${settings.branch}).`
        : "Bản hiện tại lấy từ web. Nhập token GitHub để lưu được.");
    } catch (err) {
      setStatus(err.message, "error");
    }
  }

  loadCurrent();
})();
