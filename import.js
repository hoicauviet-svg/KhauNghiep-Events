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
  function parseIncoming(text) {
    const problems = [];
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      return { problems: [{ where: "File", msg: `JSON sai cú pháp: ${err.message}` }] };
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      return { problems: [{ where: "File", msg: "File phải là một object có characters, stages hoặc randomPool." }] };

    for (const key of ["characters", "stages", "randomPool"])
      if (raw[key] != null && !Array.isArray(raw[key])) problems.push({ where: "File", msg: `"${key}" phải là một mảng.` });
    if (problems.length) return { problems };

    const file = {
      characters: raw.characters || [],
      stages: (raw.stages || []).map((s) => ({ ...s, events: s.events || [] })),
      randomPool: raw.randomPool || [],
    };
    if (!file.characters.length && !file.randomPool.length && !file.stages.length)
      problems.push({ where: "File", msg: "File không có nhân vật, màn hay tình huống nào." });

    const ids = new Set();
    for (const c of file.characters) {
      if (!c.id) problems.push({ where: "Nhân vật", msg: `"${c.name || "?"}" chưa có id.` });
      else if (ids.has(c.id)) problems.push({ where: "Nhân vật", msg: `File có hai nhân vật cùng id "${c.id}".` });
      ids.add(c.id);
    }
    file.stages.forEach((s, i) => {
      if (!s.title) problems.push({ where: `Màn ${i + 1} trong file`, msg: "Thiếu tên màn, không biết gộp vào màn nào." });
      if (!Array.isArray(s.events)) problems.push({ where: `Màn ${s.title || i + 1}`, msg: `"events" phải là một mảng.` });
    });
    if (problems.length) return { problems };

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

    const located = new Map();
    const stageLabel = (s) => `Màn ${s + 1} · ${data.stages[s].title}`;
    data.stages.forEach((stage, s) => stage.events.forEach((e, i) => located.set(e.title, { list: stage.events, i, where: stageLabel(s) })));
    data.randomPool.forEach((e, i) => located.set(e.title, { list: data.randomPool, i, where: "Kho random" }));

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
        changes.push({ type: "Màn", name: stage.title, where: stageLabel(s), action: "add" });
      }
      for (const e of stage.events) putEvent(e, data.stages[s].events, stageLabel(s));
    }
    for (const e of file.randomPool) putEvent(e, data.randomPool, "Kho random");

    return { data, changes };
  }

  // ---------- Preview ----------
  const ACTION_TEXT = { add: "Thêm mới", update: "Cập nhật", same: "Không đổi" };

  function check(text) {
    if (!current) { setStatus("Chưa tải được kịch bản hiện tại.", "error"); return; }
    const parsed = parseIncoming(text);
    incoming = parsed.file || null;
    preview = incoming ? merge(current.data, incoming) : null;
    render([...parsed.problems, ...(preview ? KN.validate(preview.data) : [])]);
  }

  function render(problems) {
    $("result").hidden = false;
    const changes = preview ? preview.changes : [];
    const count = (a) => changes.filter((c) => c.action === a).length;
    const changed = count("add") + count("update");
    const ok = preview && !problems.length;

    $("summary").textContent = !preview
      ? "Không nhập được file này."
      : `${count("add")} thêm mới, ${count("update")} cập nhật, ${count("same")} không đổi.` +
        (problems.length ? ` Còn ${problems.length} lỗi, sửa file rồi kiểm tra lại.` : changed ? " Không có lỗi." : " Không có gì để lưu.");
    $("summary").className = ok ? "ok" : "bad";

    $("problems").replaceChildren(...problems.map((p) => h("li", { class: "bad" }, `${p.where}: ${p.msg}`)));
    $("changes").replaceChildren(
      ...changes.map((c) =>
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
    $("btn-apply").disabled = true;
    setStatus("Đang lưu…");
    try {
      // Merge again onto the newest copy so edits saved meanwhile are kept.
      current = await KN.loadCurrent();
      const fresh = merge(current.data, incoming);
      const problems = KN.validate(fresh.data);
      preview = fresh;
      if (problems.length) {
        render(problems);
        setStatus("Kịch bản trên GitHub vừa đổi và bản gộp có lỗi. Chưa lưu.", "error");
        return;
      }
      const saved = await KN.saveEvents(fresh.data, current.sha, "Nhập kịch bản");
      current = { data: fresh.data, sha: saved.sha, source: "github" };
      setStatus(`Đã lưu bản v${saved.version}. Hostinger sẽ tự cập nhật sau ít phút.`);
    } catch (err) {
      setStatus(err.message, "error");
      $("btn-apply").disabled = false;
    }
  }

  function download() {
    const blob = new Blob([serialize(preview.data)], { type: "application/json" });
    const a = h("a", { href: URL.createObjectURL(blob), download: "events.json" });
    a.click();
    URL.revokeObjectURL(a.href);
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
    const text = await file.text();
    $("paste").value = text;
    check(text);
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

  $("btn-check").onclick = () => check($("paste").value);
  $("btn-use-sample").onclick = () => { $("paste").value = $("sample").textContent; check($("paste").value); };
  $("btn-apply").onclick = apply;
  $("btn-download").onclick = download;
  $("btn-settings").onclick = openSettings;

  async function loadCurrent() {
    setStatus("Đang tải…");
    try {
      current = await KN.loadCurrent();
      setStatus(current.source === "github"
        ? `Gộp vào bản trên GitHub (${settings.owner}/${settings.repo}@${settings.branch}).`
        : "Gộp vào bản đang chạy trên web. Nhập token GitHub để lưu được.");
    } catch (err) {
      setStatus(err.message, "error");
    }
  }

  fetch(`mau-import.json?t=${Date.now()}`)
    .then((res) => (res.ok ? res.text() : Promise.reject(new Error(res.status))))
    .then((text) => { $("sample").textContent = text; })
    .catch(() => { $("sample").textContent = "Không tải được file mẫu."; });
  loadCurrent();
})();
