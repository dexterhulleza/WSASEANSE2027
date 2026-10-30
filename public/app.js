'use strict';
(function () {
  const COUNTRIES = [["BN","Brunei Darussalam"],["KH","Cambodia"],["ID","Indonesia"],["LA","Lao PDR"],["MY","Malaysia"],["MM","Myanmar"],["PH","Philippines"],["SG","Singapore"],["TH","Thailand"],["TL","Timor-Leste"],["VN","Viet Nam"]];
  const CN = Object.fromEntries(COUNTRIES);
  const STAGES = ["Interest","Provisional","Definitive"];
  const STAGE_HELP = {
    Interest: "Countries indicate which skills they may enter. Names are optional.",
    Provisional: "Countries confirm likely entries once host venues, dates and requirements are shared.",
    Definitive: "Final entries with competitor and expert names, confirmed by the deadline.",
  };
  const DECISIONS = ["Pending","Accepted","Reserve","Withdrawn"];
  const DEFAULT_ROLES = [
    { id: "od", name: "Official Delegate", max: 1 },
    { id: "td", name: "Technical Delegate", max: 1 },
    { id: "tda", name: "Technical Delegate Assistant", max: 2 },
    { id: "tl", name: "Team Leader", max: 10 },
  ];
  const SKILL_STATUS = ["Proposed","Official","Demo Skill","Withdrawn"];
  const STATUS_HELP = {
    Proposed: "From the first meeting until the host has accepted enough participants.",
    Official: "The host's accepted number of participants has been reached.",
    "Demo Skill": "Not enough accepted participants, but the skill continues as a demonstration only.",
    Withdrawn: "The skill will not run.",
  };
  const DOC_KINDS = {
    skill: ["Technical description","Infrastructure list","Test project","Marking scheme","Workshop layout","Health and safety plan","Other"],
    host: ["Host information pack","Travel and accommodation","Invitation letter template","CIS guide","Other"],
    entry: ["Registration form","Consent form","Other"],
  };
  const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.csv,.txt,.md,.json";
  const TYPE_BY_EXT = { pdf:"application/pdf", png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", webp:"image/webp", csv:"text/csv", txt:"text/plain", md:"text/markdown", json:"application/json" };

  const S = {
    ready: false, me: null, today: "", signupAllowed: true,
    settings: { hostCountries: [], windowStart: "2027-08-02", windowEnd: "2027-09-30", registration: { Interest: { open: "", close: "" }, Provisional: { open: "", close: "" }, Definitive: { open: "", close: "" } }, roles: DEFAULT_ROLES, delegationReg: { open: "", close: "" } },
    skills: [], entries: [], stats: {}, totals: { entries: 0, countries: 0 }, delegates: [], hosts: {}, users: [], people: {}, log: [],
    actingAs: "", view: "skills", authView: "login", newPw: null, pwPrompted: false, deferred: false,
    filter: { host: "all", status: "active", q: "" }, openSkill: null, pendingDel: null,
  };
  Object.defineProperty(S, "isCentral", { get() { return !!(S.me && S.me.status === "active" && S.me.role === "central"); } });
  Object.defineProperty(S, "uid", { get() { return (S.me && S.me.id) || null; } });
  try { S.actingAs = localStorage.getItem("ws27-acting") || ""; } catch (e) {}

  /* ---------- helpers ---------- */
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const fmtDate = (s) => { if (!s) return ""; const [y, m, d] = s.split("-").map(Number); return d && m ? `${d} ${MON[m - 1]} ${y}` : esc(s); };
  const dayDiff = (a, b) => Math.round((Date.UTC(...b.split("-").map((v, i) => i === 1 ? v - 1 : +v)) - Date.UTC(...a.split("-").map((v, i) => i === 1 ? v - 1 : +v))) / 86400000);
  const fmtWhen = (t) => { const d = new Date(t); return `${d.getDate()} ${MON[d.getMonth()]} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; };
  const countryName = (c) => (c === "CENTRAL" ? "Central Secretariat" : CN[c] || c || "—");
  const nameOf = (id) => (id && id === S.uid ? "You" : (id && S.people[id]) || "Someone");
  const asLabel = (a) => { a = String(a || ""); if (a.startsWith("CENTRAL")) { const c = a.split(":")[1]; return c ? `Central for ${countryName(c)}` : "Central Secretariat"; } return countryName(a); };
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2800); }

  const member = () => (S.me && S.me.status === "active" && S.me.role === "country" && S.me.country ? { country: S.me.country } : null);
  const myCountry = () => (S.isCentral ? S.actingAs : (member() && member().country) || "");
  const isHost = (c) => (S.settings.hostCountries || []).includes(c);
  const skillById = (id) => S.skills.find((s) => s.id === id);
  const canEditSkill = (sk) => S.isCentral || (member() && member().country === sk.host && isHost(sk.host));
  const canEditEntry = (e) => S.isCentral || (member() && member().country === e.country);
  const canSeeEntry = (e) => { if (S.isCentral) return true; const m = member(); if (!m) return false; const sk = skillById(e.skillId); return e.country === m.country || (sk && sk.host === m.country); };
  const canDecide = (e) => { if (S.isCentral) return true; const m = member(); const sk = skillById(e.skillId); return !!(m && sk && m.country === sk.host && isHost(sk.host)); };
  const todayStr = () => { if (S.today) return S.today; const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const reg = () => S.settings.registration || {};
  function currentStage() { const t = todayStr(), r = reg(); return STAGES.find((st) => r[st] && r[st].open && r[st].close && t >= r[st].open && t <= r[st].close) || null; }
  function nextStage() { const t = todayStr(), r = reg(); return STAGES.find((st) => r[st] && r[st].open && r[st].open > t) || null; }
  const decisionOf = (e) => e.decision || "Pending";
  const isActive = (e) => !["Withdrawn", "Reserve"].includes(decisionOf(e));
  const canAddEntries = () => !!myCountry() && !!currentStage() && (S.isCentral || !!member());
  const roles = () => (Array.isArray(S.settings.roles) && S.settings.roles.length ? S.settings.roles : DEFAULT_ROLES);
  const roleName = (id) => (roles().find((r) => r.id === id) || {}).name || "Removed role";
  function delegOpen() { const r = S.settings.delegationReg || {}, t = todayStr(); return !!(r.open && r.close && t >= r.open && t <= r.close); }
  function delegBanner() {
    const r = S.settings.delegationReg || {};
    if (delegOpen()) return `<div class="note"><b>Delegation registration is open</b> until ${fmtDate(r.close)}.</div>`;
    const t = todayStr();
    return `<div class="note warn"><b>Delegation registration is closed.</b> ${r.open && r.open > t ? `It opens on ${fmtDate(r.open)}.` : "The Central Secretariat sets when it opens."}</div>`;
  }
  const canSeeDelegate = (d) => S.isCentral || (member() && member().country === d.country);
  const canManageDelegation = (c) => !!c && (S.isCentral || (member() && member().country === c));
  function regBanner() {
    const cur = currentStage(), nx = nextStage(), r = reg();
    if (cur) return `<div class="note"><b>Registration open: ${esc(cur)} stage</b> until ${fmtDate(r[cur].close)}. <span class="muted">${esc(STAGE_HELP[cur])}</span></div>`;
    return `<div class="note warn"><b>Registration is closed.</b> ${nx ? `The ${esc(nx)} stage opens on ${fmtDate(r[nx].open)}.` : "No further stage is scheduled."} <span class="muted">The Central Secretariat sets the registration periods.</span></div>`;
  }

  function demand(sk) {
    const st = S.stats[sk.id] || { n: 0, countries: 0, accepted: 0 };
    const n = st.n, countries = st.countries, accepted = st.accepted;
    const min = Number(sk.min) || 0, max = Number(sk.max) || 0;
    let label = "No limits set", cls = "", rule = "Host to set minimum and maximum";
    if (min || max) {
      if (min && n < min) { label = "Below minimum"; cls = "warn"; rule = "Each country may enter up to 2"; }
      else if (max && n > max && countries > max) { label = "Over capacity"; cls = "bad"; rule = "OCM-chosen method; rest to reserve list"; }
      else if (max && n > max) { label = "Above maximum"; cls = "bad"; rule = "Host checks extra workstations; else 1 per country"; }
      else { label = "Within range"; cls = "good"; rule = "Accept all eligible entries"; }
    }
    let hint = "";
    if (sk.status === "Proposed" && min && accepted >= min) hint = "Ready to make Official";
    else if (sk.status === "Proposed" && min && reg().Definitive && reg().Definitive.close && todayStr() > reg().Definitive.close && accepted < min) hint = "Below accepted minimum: decide Demo Skill or Withdrawn";
    return { n, accepted, countries, min, max, left: max ? max - n : null, label, cls, rule, hint };
  }
  const statusPill = (s) => `<span class="pill ${s === "Official" ? "good" : s === "Demo Skill" ? "warn" : s === "Withdrawn" ? "bad" : ""}" title="${esc(STATUS_HELP[s || "Proposed"] || "")}">${esc(s || "Proposed")}</span>`;
  const stagePill = (s) => `<span class="pill ${s === "Definitive" ? "good" : s === "Provisional" ? "info" : ""}">${esc(s || "Interest")}</span>`;
  const decisionPill = (s) => `<span class="pill ${s === "Accepted" ? "good" : s === "Reserve" ? "warn" : s === "Withdrawn" ? "bad" : ""}">${esc(s)}</span>`;
  function meter(d) {
    if (!d.max) return `<span class="muted">—</span>`;
    const top = Math.max(d.max, d.n, 1);
    const w = Math.min(100, (d.n / top) * 100);
    const minAt = d.min ? (d.min / top) * 100 : null;
    return `<div class="meter" role="img" aria-label="${d.n} of ${d.max} places"><i class="${d.n > d.max ? "over" : ""}" style="width:${w}%"></i>${minAt !== null ? `<u style="left:calc(${minAt}% - 1px)" title="Minimum ${d.min}"></u>` : ""}</div>`;
  }
  function docList(docs, scope, targetId, editable) {
    if (!docs || !docs.length) return `<div class="empty">No documents yet.${editable ? " Upload PDFs, images, CSV or text files." : ""}</div>`;
    return `<ul class="doclist">${docs.map((d) => {
      const key = `${scope}|${targetId}|${d.id}`;
      return `<li><span><a href="/api/files/${esc(d.id)}" target="_blank" rel="noopener">${esc(d.name)}</a> <span class="muted">· ${esc(d.kind)} · ${fmtWhen(d.at)} · ${esc(nameOf(d.by))}</span></span>
      ${editable ? (S.pendingDel === key
        ? `<span><button class="btn small danger" data-act="doc-del-confirm" data-key="${esc(key)}">Confirm remove</button> <button class="btn small" data-act="doc-del-cancel">Keep</button></span>`
        : `<button class="btn small" data-act="doc-del" data-key="${esc(key)}">Remove</button>`) : ""}</li>`;
    }).join("")}</ul>`;
  }

  /* ---------- server ---------- */
  function report(msg) {
    const p = (!$("#modal").hidden && $("#modal #form-err")) || $("#main #form-err");
    if (p) { p.textContent = msg; p.hidden = false; } else toast(msg);
  }
  async function api(method, url, body, okMsg, opts = {}) {
    let res, data = {};
    try {
      res = await fetch(url, {
        method, credentials: "same-origin",
        headers: { "Content-Type": opts.raw ? opts.type : "application/json", "X-Requested-With": "fetch" },
        body: opts.raw ? body : body === undefined ? undefined : JSON.stringify(body),
      });
      data = await res.json().catch(() => ({}));
    } catch (e) { report("Couldn't reach the server. Check your connection and try again."); return null; }
    if (res.status === 401 && !opts.auth) { S.me = null; stopLive(); closeModal(); render(); toast("Your session ended. Please sign in again."); return null; }
    if (!res.ok) { report(data.error || "Couldn't save. Try again."); return null; }
    if (okMsg) toast(okMsg);
    if (!opts.noRefresh) await refresh();
    return data;
  }
  async function refresh() {
    try {
      const r = await fetch("/api/state", { credentials: "same-origin" });
      if (r.status === 401) { S.me = null; S.ready = true; stopLive(); render(); return; }
      const d = await r.json();
      Object.assign(S, {
        me: d.me, today: d.today, signupAllowed: d.signupAllowed !== false, settings: { ...S.settings, ...d.settings },
        skills: d.skills || [], hosts: d.hosts || {}, stats: d.stats || {}, totals: d.totals || { entries: 0, countries: 0 },
        entries: d.entries || [], delegates: d.delegates || [], people: d.people || {}, users: d.users || [], log: d.log || [],
      });
      S.ready = true; render(true);
      if (S.me && S.me.mustChange && !S.pwPrompted && $("#modal").hidden) { S.pwPrompted = true; passwordForm(true); }
    } catch (e) { S.ready = true; render(true); }
  }
  let es = null, rt = null;
  function startLive() {
    if (es || !S.me) return;
    es = new EventSource("/api/events");
    es.addEventListener("change", () => { clearTimeout(rt); rt = setTimeout(scheduleRefresh, 250); });
  }
  function stopLive() { if (es) { es.close(); es = null; } }
  function busyTyping() { const a = document.activeElement; return !!(a && a.matches("input, select, textarea") && (a.closest("#main form") || a.closest("#modal"))); }
  function scheduleRefresh() { if (busyTyping() || !$("#modal").hidden) { S.deferred = true; return; } S.deferred = false; refresh(); }
  function resolveNames() {}

  /* ---------- render ---------- */
  function render(skipNames) {
    if (S.ready && !S.isCentral && S.actingAs) S.actingAs = "";
    renderWho(); renderTabs();
    const main = $("#main");
    if (!S.ready) return;
    if (!S.me) { main.innerHTML = viewAuth(); return; }
    const v = S.view;
    main.innerHTML = v === "entries" ? viewEntries() : v === "delegation" ? viewDelegation() : v === "host" ? viewHost() : v === "central" ? viewCentral() : viewSkills();
    if (S.openSkill) renderSkillSheet();
    if (!skipNames) resolveNames();
  }
  function renderWho() {
    const el = $("#who");
    if (!S.ready || !S.me) { el.innerHTML = ""; return; }
    const m = member();
    const role = S.isCentral ? "Central Secretariat" : m ? `${countryName(m.country)} Secretariat${isHost(m.country) ? " · Host" : ""}` : S.me.status === "pending" ? "Awaiting approval" : "No access";
    el.innerHTML = `<span>${esc(S.me.name)} · <span class="role">${esc(role)}</span></span>
      ${S.isCentral ? `<label><span style="color:var(--band-muted)">Acting for</span>
        <select id="acting" data-change="acting"><option value="">— Central only —</option>${COUNTRIES.map(([c, n]) => `<option value="${c}" ${S.actingAs === c ? "selected" : ""}>${n}${isHost(c) ? " (host)" : ""}</option>`).join("")}</select></label>` : ""}
      <button class="linkbtn" data-act="password">Password</button><button class="linkbtn" data-act="logout">Sign out</button>`;
  }
  function renderTabs() {
    const c = myCountry();
    const tabs = S.me ? [["skills", "Skills catalogue"]] : [];
    if (S.ready && S.me && S.me.status === "active") {
      tabs.push(["entries", c ? `${countryName(c)} entries` : "Our entries"]);
      if (c) tabs.push(["delegation", `${countryName(c)} delegation`]);
      if (c && isHost(c)) tabs.push(["host", "Host desk"]);
      if (S.isCentral) tabs.push(["central", "Central"]);
    }
    if (tabs.length && !tabs.some((t) => t[0] === S.view)) S.view = "skills";
    $("#tabs").innerHTML = tabs.map(([k, l]) => `<a href="#${k}" ${S.view === k ? 'aria-current="page"' : ""}>${esc(l)}</a>`).join("");
  }

  /* ---- Skills catalogue ---- */
  function filteredSkills() {
    const f = S.filter, q = f.q.trim().toLowerCase();
    return S.skills.filter((s) => (f.host === "all" || s.host === f.host)
      && (f.status === "all" || (f.status === "active" ? s.status !== "Withdrawn" : s.status === f.status))
      && (!q || (s.name || "").toLowerCase().includes(q) || (s.city || "").toLowerCase().includes(q)))
      .sort((a, b) => (a.host || "").localeCompare(b.host || "") || (a.name || "").localeCompare(b.name || ""));
  }
  function skillRows() {
    const list = filteredSkills();
    if (!S.skills.length) return `<div class="empty">No skills in the catalogue yet. Host Secretariats add their skills from the Host desk.</div>`;
    if (!list.length) return `<div class="empty">No skills match these filters.</div>`;
    const seeEntries = S.isCentral || !!member();
    return `<div class="tablebox"><table><thead><tr><th>Skill</th><th>Host</th><th>C1–C3</th><th class="num">Min–Max</th><th class="num">Entries</th><th>Places</th><th>Demand</th><th>Status</th></tr></thead><tbody>
      ${list.map((s) => { const d = demand(s); return `<tr class="click" tabindex="0" data-act="open-skill" data-id="${esc(s.id)}">
        <td><b>${esc(s.name)}</b><span class="sub">${esc(s.type || "Individual")}${s.city ? " · " + esc(s.city) : ""}${s.open === false ? " · closed for entries" : ""}</span></td>
        <td><span class="host">${esc(s.host)}</span></td>
        <td class="num">${s.c1 ? fmtDate(s.c1) + (s.c3 ? "<span class='sub'>to " + fmtDate(s.c3) + "</span>" : "") : "<span class='muted'>TBC</span>"}</td>
        <td class="num">${d.min || d.max ? `${d.min || "–"}–${d.max || "–"}` : "<span class='muted'>—</span>"}</td>
        <td class="num">${seeEntries ? `${d.n}<span class="sub">${d.countries} countr${d.countries === 1 ? "y" : "ies"}</span>` : "<span class='muted'>—</span>"}</td>
        <td>${seeEntries ? meter(d) + (d.left !== null ? `<span class="sub num">${d.left >= 0 ? d.left + " left" : -d.left + " over"}</span>` : "") : "<span class='muted'>—</span>"}</td>
        <td>${seeEntries ? `<span class="pill ${d.cls}">${esc(d.label)}</span>` : "<span class='muted'>—</span>"}</td>
        <td>${statusPill(s.status)}</td></tr>`; }).join("")}
      </tbody></table></div>`;
  }
  function viewSkills() {
    const hosts = [...new Set(S.skills.map((s) => s.host))].sort();
    const liveSkills = S.skills.filter((s) => s.status !== "Withdrawn");

    const seeEntries = S.isCentral || !!member();
    return `<div class="pagehead"><div><h1>Skills catalogue</h1>
      <p class="muted">Every skill offered by the host countries. Competition window ${fmtDate(S.settings.windowStart)} – ${fmtDate(S.settings.windowEnd)} (tentative). Select a skill for details, documents and entries.</p></div></div>
      <div class="stats"><div class="stat"><b>${liveSkills.length}</b><span>Skills</span></div><div class="stat"><b>${new Set(liveSkills.map((s) => s.host)).size}</b><span>Hosts</span></div>
      ${seeEntries ? `<div class="stat"><b>${S.totals.entries}</b><span>Entries</span></div><div class="stat"><b>${S.totals.countries}</b><span>Countries entering</span></div>` : ""}</div>
      ${regBanner()}
      ${!seeEntries && S.ready ? accessNote() : ""}
      <div class="filters">
        <button class="chip" data-act="f-host" data-v="all" aria-pressed="${S.filter.host === "all"}">All hosts</button>
        ${hosts.map((h) => `<button class="chip" data-act="f-host" data-v="${esc(h)}" aria-pressed="${S.filter.host === h}">${esc(countryName(h))}</button>`).join("")}
        <select id="f-status" data-change="f-status" aria-label="Status"><option value="active" ${S.filter.status === "active" ? "selected" : ""}>Active skills</option>${SKILL_STATUS.map((s) => `<option ${S.filter.status === s ? "selected" : ""}>${s}</option>`).join("")}<option value="all" ${S.filter.status === "all" ? "selected" : ""}>All statuses</option></select>
        <input type="search" id="f-q" placeholder="Search skill or city" value="${esc(S.filter.q)}" aria-label="Search skills">
      </div>
      <div id="skill-list">${skillRows()}</div>`;
  }
  function accessNote() {
    if (S.me && S.me.status === "pending") return `<div class="note"><b>Your account is waiting for approval.</b> The Central Secretariat will confirm you as the ${esc(countryName(S.me.country))} Secretariat. You can browse the skills catalogue meanwhile.</div>`;
    if (S.me && S.me.status === "active" && S.me.role === "country" && !S.me.country) return `<div class="note warn">Your account has no country yet. Ask the Central Secretariat to assign one.</div>`;
    return "";
  }
  function viewAuth() {
    const signup = S.authView === "signup" && S.signupAllowed;
    return `<div class="auth"><div class="panel">
      <img src="/logo-red.png" alt="WorldSkills ASEAN Special Edition 2027" class="authlogo">
      <h1>${signup ? "Request an account" : "Sign in"}</h1>
      <p class="muted" style="margin:0">${signup ? "For Country Secretariat staff. The Central Secretariat approves each request." : "Skills registry for the Central, Host and Country Secretariats."}</p>
      <form class="f" data-form="${signup ? "signup" : "login"}">
        ${signup ? `<label class="fl">Full name<input type="text" name="name" id="au-name" required maxlength="100" autocomplete="name"></label>
        <label class="fl">Country<select name="country" id="au-country" required><option value="">Choose…</option>${COUNTRIES.map(([c, n]) => `<option value="${c}">${n}</option>`).join("")}</select></label>` : ""}
        <label class="fl">Email<input type="email" name="email" id="au-email" required maxlength="160" autocomplete="email"></label>
        <label class="fl">Password${signup ? " <small>at least 10 characters</small>" : ""}<input type="password" name="password" id="au-pw" required ${signup ? 'minlength="10" autocomplete="new-password"' : 'autocomplete="current-password"'}></label>
        <p class="err" id="form-err" hidden></p>
        <div class="factions" style="justify-content:space-between">${S.signupAllowed ? `<button type="button" class="btn" data-act="auth-switch">${signup ? "I have an account" : "Request an account"}</button>` : "<span></span>"}<button class="btn primary" type="submit">${signup ? "Send request" : "Sign in"}</button></div>
      </form>
      ${signup ? "" : `<p class="muted" style="font-size:.9rem;margin:0">Forgot your password? Ask the Central Secretariat to reset it.</p>`}
    </div></div>`;
  }

  /* ---- Skill sheet ---- */
  function renderSkillSheet() {
    const sk = skillById(S.openSkill);
    if (!sk) { closeModal(); return; }
    const d = demand(sk), editable = canEditSkill(sk), c = myCountry();
    const seeAll = S.isCentral || (member() && member().country === sk.host);
    const ents = S.entries.filter((e) => e.skillId === sk.id && canSeeEntry(e));
    const others = Math.max(0, ((S.stats[sk.id] || {}).n || 0) - ents.filter(isActive).length);
    const canAdd = canAddEntries() && sk.open !== false && sk.status !== "Withdrawn";
    openModal(`<div class="sheet-head"><div><span class="host">${esc(sk.host)}</span> ${statusPill(sk.status)}<h2 style="margin-top:6px">${esc(sk.name)}</h2><span style="color:var(--band-muted)">${esc(countryName(sk.host))}${sk.city ? " · " + esc(sk.city) : ""}</span></div>
      <button class="x" data-act="close">Close</button></div>
      <div class="sheet-body">
        <div class="panel"><div class="panel-head"><h3>Details</h3>${editable ? `<button class="btn small" data-act="edit-skill" data-id="${esc(sk.id)}">Edit skill</button>` : ""}</div>
        <dl class="facts">
          <dt>Type</dt><dd>${esc(sk.type || "Individual")}${sk.type === "Team" && sk.teamSize ? ` · ${esc(sk.teamSize)} per team` : ""}</dd>
          <dt>Venue</dt><dd>${esc(sk.venue) || "<span class='muted'>TBC</span>"}${sk.city ? ", " + esc(sk.city) : ""}</dd>
          <dt>Competition</dt><dd class="num">${sk.c1 ? `C1 ${fmtDate(sk.c1)}${sk.c3 ? ` · C3 ${fmtDate(sk.c3)}` : ""}` : "<span class='muted'>Dates TBC</span>"}</dd>
          <dt>Workstations</dt><dd class="num">${esc(sk.workstations) || "—"}</dd>
          <dt>Status</dt><dd>${statusPill(sk.status)} <span class="muted">${esc(STATUS_HELP[sk.status || "Proposed"])}</span></dd>
          <dt>Entries allowed</dt><dd class="num">${d.min || d.max ? `Minimum ${d.min || "–"} · Maximum ${d.max || "–"}` : "<span class='muted'>Not set</span>"}</dd>
          <dt>Infrastructure list</dt><dd>${esc(sk.infra) || "—"}</dd>
          <dt>Technical lead</dt><dd>${esc(sk.techLead) || "—"}</dd>
          <dt>Workshop manager</dt><dd>${esc(sk.workshopManager) || "—"}</dd>
          ${sk.gaps ? `<dt>Technical gaps</dt><dd>${esc(sk.gaps)}</dd>` : ""}
          ${sk.notes ? `<dt>Notes</dt><dd>${esc(sk.notes)}</dd>` : ""}
          <dt>Entries</dt><dd>${sk.open === false ? "Closed" : "Open"}</dd>
        </dl></div>
        ${(S.isCentral || member()) ? `<div class="panel"><div class="panel-head"><h3>Demand</h3><span class="pill ${d.cls}">${esc(d.label)}</span></div>
          ${meter(d)}<div class="muted num">${d.n} active entr${d.n === 1 ? "y" : "ies"} from ${d.countries} countr${d.countries === 1 ? "y" : "ies"} · ${d.accepted} accepted${d.min ? ` of ${d.min} needed for Official` : ""}${d.max ? ` · ${d.max} places` : ""}. Rule to apply: <b style="color:var(--ink)">${esc(d.rule)}</b>.${d.hint ? ` <span class="pill info">${esc(d.hint)}</span>` : ""}</div></div>` : ""}
        <div class="panel"><div class="panel-head"><h3>Documents</h3>${editable ? `<button class="btn small" data-act="upload" data-scope="skill" data-id="${esc(sk.id)}">Upload document</button>` : ""}</div>
          ${docList(sk.docs, "skill", sk.id, editable)}</div>
        ${(S.isCentral || member()) ? `<div class="panel"><div class="panel-head"><h3>Entries${seeAll ? "" : c ? ` from ${esc(countryName(c))}` : ""}</h3>${canAdd ? `<button class="btn small primary" data-act="add-entry" data-skill="${esc(sk.id)}">Add ${esc(countryName(c))} entry</button>` : ""}</div>
          ${ents.length ? entryTable(ents, { showSkill: false, decide: true }) : `<div class="empty">No entries${seeAll ? "" : " from your country"} yet.</div>`}
          ${!seeAll && others ? `<div class="muted">${others} entr${others === 1 ? "y" : "ies"} from other countries.</div>` : ""}</div>` : ""}
      </div>`);
  }

  /* ---- entries table ---- */
  function entryTable(list, o) {
    const open = !!currentStage();
    return `<div class="tablebox"><table><thead><tr>${o.showSkill ? "<th>Skill</th><th>Host</th>" : ""}<th>Country</th><th>Competitor(s)</th><th>Expert</th><th>Stage</th><th>Decision</th><th>Documents</th><th></th></tr></thead><tbody>
      ${list.map((e) => { const sk = skillById(e.skillId) || {}; const ed = canEditEntry(e), dec = decisionOf(e);
        const canEditNow = ed && (S.isCentral || (open && dec !== "Withdrawn"));
        return `<tr>${o.showSkill ? `<td><b>${esc(sk.name || "Removed skill")}</b></td><td><span class="host">${esc(sk.host || "?")}</span></td>` : ""}
        <td>${esc(countryName(e.country))}</td><td>${esc(e.competitors) || "<span class='muted'>TBC</span>"}</td><td>${esc(e.expert) || "<span class='muted'>TBC</span>"}</td>
        <td>${stagePill(e.stage)}</td>
        <td>${o.decide && canDecide(e) ? `<select data-change="decision" data-id="${esc(e.id)}" aria-label="Decision">${DECISIONS.map((s) => `<option ${dec === s ? "selected" : ""}>${s}</option>`).join("")}</select>` : decisionPill(dec)}</td>
        <td>${(e.docs || []).length ? `${e.docs.length} file${e.docs.length === 1 ? "" : "s"}` : "<span class='muted'>None</span>"}</td>
        <td style="white-space:nowrap">${canEditNow ? `<button class="btn small" data-act="edit-entry" data-id="${esc(e.id)}">Edit</button> ` : ""}<button class="btn small" data-act="entry-docs" data-id="${esc(e.id)}">Files</button>${ed && dec !== "Withdrawn" && !S.isCentral ? ` <button class="btn small danger" data-act="withdraw" data-id="${esc(e.id)}">Withdraw</button>` : ""}</td></tr>`; }).join("")}
      </tbody></table></div>`;
  }

  /* ---- Our entries ---- */
  function viewEntries() {
    const c = myCountry();
    if (!c) {
      if (S.isCentral) return `<div class="pagehead"><div><h1>Country entries</h1><p class="muted">Choose a country in "Acting for" at the top to register or edit entries on its behalf.</p></div></div>`;
      return `<div class="pagehead"><div><h1>Our entries</h1><p class="muted">Country Secretariats register their competitors here, in any skill at any host.</p></div></div>${accessNote()}`;
    }
    const list = S.entries.filter((e) => e.country === c).sort((a, b) => ((skillById(a.skillId) || {}).host || "").localeCompare((skillById(b.skillId) || {}).host || ""));
    const live = list.filter((e) => decisionOf(e) !== "Withdrawn");
    const hostsEntered = new Set(live.map((e) => (skillById(e.skillId) || {}).host).filter(Boolean));
    return `<div class="pagehead"><div><h1>${esc(countryName(c))} entries</h1>
      <p class="muted">Register competitors or teams in any skill that is open, at any host, while a registration stage is open: Interest, then Provisional, then Definitive. The host or the Central Secretariat records each decision.</p></div>
      ${canAddEntries() ? `<button class="btn primary" data-act="add-entry">Add entry</button>` : ""}</div>
      ${regBanner()}
      <div class="stats"><div class="stat"><b>${live.length}</b><span>Active entries</span></div>${STAGES.map((st) => `<div class="stat"><b>${live.filter((e) => (e.stage || "Interest") === st).length}</b><span>${st}</span></div>`).join("")}<div class="stat"><b>${live.filter((e) => decisionOf(e) === "Accepted").length}</b><span>Accepted</span></div><div class="stat"><b>${hostsEntered.size}</b><span>Hosts</span></div></div>
      ${list.length ? entryTable(list, { showSkill: true }) : `<div class="empty">No entries yet. While a stage is open, choose <b>Add entry</b> and pick a skill. Competitor names can follow at the Definitive stage.</div>`}`;
  }

  /* ---- Host desk ---- */
  function viewHost() {
    const c = myCountry();
    if (!c || !isHost(c)) return `<div class="empty">Host desk is for host countries.</div>`;
    const h = S.hosts[c] || {};
    const mySkills = S.skills.filter((s) => s.host === c).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    const ids = new Set(mySkills.map((s) => s.id));
    const received = S.entries.filter((e) => ids.has(e.skillId));
    return `<div class="pagehead"><div><h1>${esc(countryName(c))} host desk</h1><p class="muted">Manage your skills, host information and documents, and see every entry received in your skills.</p></div>
      <button class="btn primary" data-act="add-skill">Add skill</button></div>
      <div class="grid2">
        <div class="panel"><div class="panel-head"><h2>Host information</h2><button class="btn small" data-act="edit-host">Edit</button></div>
          <dl class="facts"><dt>Host Secretariat</dt><dd>${esc(h.contact) || "<span class='muted'>Not set</span>"}</dd><dt>Email</dt><dd>${esc(h.email) || "—"}</dd><dt>Phone</dt><dd>${esc(h.phone) || "—"}</dd>
          <dt>Cities</dt><dd>${esc(h.cities) || "—"}</dd><dt>Announcement</dt><dd>${esc(h.announcement) || "—"}</dd></dl></div>
        <div class="panel"><div class="panel-head"><h2>Host documents</h2><button class="btn small" data-act="upload" data-scope="host" data-id="${esc(c)}">Upload</button></div>
          ${docList(h.docs, "host", c, true)}</div>
      </div>
      <div class="panel"><div class="panel-head"><h2>Our skills</h2><span class="muted">${mySkills.length} skill${mySkills.length === 1 ? "" : "s"}</span></div>
        ${mySkills.length ? `<div class="tablebox"><table><thead><tr><th>Skill</th><th>C1–C3</th><th class="num">Workstations</th><th class="num">Min–Max</th><th class="num">Entries</th><th class="num">Accepted</th><th>Demand</th><th>Status</th><th></th></tr></thead><tbody>
          ${mySkills.map((s) => { const d = demand(s); return `<tr><td><b>${esc(s.name)}</b><span class="sub">${esc(s.type || "Individual")}${s.venue ? " · " + esc(s.venue) : ""}</span></td>
          <td class="num">${s.c1 ? fmtDate(s.c1) + (s.c3 ? "<span class='sub'>to " + fmtDate(s.c3) + "</span>" : "") : "<span class='muted'>TBC</span>"}</td><td class="num">${esc(s.workstations) || "—"}</td>
          <td class="num">${d.min || d.max ? `${d.min || "–"}–${d.max || "–"}` : "—"}</td><td class="num">${d.n}</td><td class="num">${d.accepted}${d.min ? `/${d.min}` : ""}</td><td><span class="pill ${d.cls}">${esc(d.label)}</span></td><td>${statusPill(s.status)}${d.hint ? `<span class="sub">${esc(d.hint)}</span>` : ""}</td>
          <td style="white-space:nowrap"><button class="btn small" data-act="edit-skill" data-id="${esc(s.id)}">Edit</button> <button class="btn small" data-act="open-skill" data-id="${esc(s.id)}">Open</button></td></tr>`; }).join("")}
          </tbody></table></div>` : `<div class="empty">No skills yet. Choose <b>Add skill</b>; it starts as Proposed and becomes Official once you have accepted enough participants.</div>`}</div>
      <div class="panel"><div class="panel-head"><h2>Entries received</h2><span class="muted">${received.filter(isActive).length} active · set each entry's decision</span></div>
        ${received.length ? entryTable(received, { showSkill: true, decide: true }) : `<div class="empty">No entries in your skills yet.</div>`}</div>`;
  }

  /* ---- Delegation ---- */
  function viewDelegation() {
    const c = myCountry();
    if (!c) return `<div class="empty">Choose a country in "Acting for" to manage its delegation.</div>`;
    const mine = S.delegates.filter((d) => d.country === c);
    const open = delegOpen(), can = canManageDelegation(c);
    const total = roles().reduce((a, r) => a + (Number(r.max) || 0), 0);
    return `<div class="pagehead"><div><h1>${esc(countryName(c))} delegation</h1>
      <p class="muted">Register your country's representatives. Each role has a set number of places, decided by the Central Secretariat.</p></div></div>
      ${delegBanner()}
      <div class="stats"><div class="stat"><b>${mine.length}<span style="font-size:1rem;color:var(--muted)"> / ${total}</span></b><span>Registered</span></div>
        ${roles().map((r) => { const n = mine.filter((d) => d.role === r.id).length; return `<div class="stat"><b>${n}<span style="font-size:1rem;color:var(--muted)"> / ${esc(r.max)}</span></b><span>${esc(r.name)}</span></div>`; }).join("")}</div>
      ${roles().map((r) => { const list = mine.filter((d) => d.role === r.id); const full = list.length >= (Number(r.max) || 0);
        return `<div class="panel"><div class="panel-head"><h2>${esc(r.name)} <span class="muted num" style="font-size:1rem;font-weight:500">${list.length} of ${esc(r.max)}</span></h2>
          ${can ? (open && !full ? `<button class="btn small primary" data-act="add-delegate" data-role="${esc(r.id)}">Add ${esc(r.name)}</button>` : `<span class="muted">${!open ? "Registration closed" : "All places filled"}</span>`) : ""}</div>
          ${list.length ? delegateTable(list, can && (open || S.isCentral)) : `<div class="empty">No ${esc(r.name)} registered yet.</div>`}
          ${list.length > (Number(r.max) || 0) ? `<div class="note warn">${list.length - r.max} more than the ${esc(r.max)} place${Number(r.max) === 1 ? "" : "s"} now allowed. Remove someone, or ask the Central Secretariat to raise the number.</div>` : ""}</div>`; }).join("")}
      ${mine.some((d) => !roles().some((r) => r.id === d.role)) ? `<div class="panel"><h2>Roles no longer in use</h2>${delegateTable(mine.filter((d) => !roles().some((r) => r.id === d.role)), can)}</div>` : ""}`;
  }
  function delegateTable(list, editable) {
    return `<div class="tablebox"><table><thead><tr><th>Name</th><th>Position and organisation</th><th>Email</th><th>Phone</th><th></th></tr></thead><tbody>
      ${list.map((d) => `<tr><td><b>${esc(d.name)}</b>${d.notes ? `<span class="sub">${esc(d.notes)}</span>` : ""}</td><td>${esc(d.position) || "—"}</td><td>${esc(d.email) || "—"}</td><td class="num">${esc(d.phone) || "—"}</td>
        <td style="white-space:nowrap">${editable ? `<button class="btn small" data-act="edit-delegate" data-id="${esc(d.id)}">Edit</button> <button class="btn small danger" data-act="del-delegate" data-id="${esc(d.id)}">Remove</button>` : ""}</td></tr>`).join("")}
      </tbody></table></div>`;
  }

  /* ---- Central ---- */
  function viewCentral() {
    const live = [...S.skills].sort((a, b) => (a.host || "").localeCompare(b.host || "") || (a.name || "").localeCompare(b.name || ""));
    const pendingUsers = S.users.filter((u) => u.status === "pending");
    const otherUsers = S.users.filter((u) => u.status !== "pending");
    const entries = [...S.entries].sort((a, b) => ((skillById(a.skillId) || {}).name || "").localeCompare((skillById(b.skillId) || {}).name || "") || a.country.localeCompare(b.country));
    return `<div class="pagehead"><div><h1>Central Secretariat</h1><p class="muted">Settings, accounts, demand vs capacity, entry decisions and the activity log.</p></div>
      <div class="filters"><a class="btn" href="/api/export/entries.csv">Export entries</a><a class="btn" href="/api/export/delegates.csv">Export delegations</a><a class="btn" href="/api/export/skills.csv">Export skills</a></div></div>
      <div class="grid2">
        <div class="panel"><h2>Settings</h2>
          <form class="f" data-form="settings"><div class="frow">
            <label class="fl">Competition window opens<input type="date" name="windowStart" id="set-ws" value="${esc(S.settings.windowStart)}"></label>
            <label class="fl">Competition window closes<input type="date" name="windowEnd" id="set-we" value="${esc(S.settings.windowEnd)}"></label></div>
            <fieldset style="border:0;padding:0;margin:0;display:grid;gap:8px"><legend style="font-weight:600;margin-bottom:6px">Registration periods <span class="muted" style="font-weight:400">· Country Secretariats can add or update entries only while a stage is open</span></legend>
            ${STAGES.map((st) => `<div class="frow"><label class="fl">${st} opens<input type="date" name="${st}-open" id="reg-${st}-open" value="${esc((reg()[st] || {}).open)}"></label><label class="fl">${st} closes<input type="date" name="${st}-close" id="reg-${st}-close" value="${esc((reg()[st] || {}).close)}"></label></div>`).join("")}</fieldset>
            <fieldset style="border:0;padding:0;margin:0;display:grid;gap:6px"><legend style="font-weight:600;margin-bottom:6px">Host countries</legend>
            <div class="frow">${COUNTRIES.map(([c, n]) => `<label class="chk"><input type="checkbox" name="host" id="host-${c}" value="${c}" ${isHost(c) ? "checked" : ""}> ${n}</label>`).join("")}</div></fieldset>
            <div class="factions"><button class="btn primary" type="submit">Save settings</button></div></form></div>
        <div class="panel"><h2>Accounts</h2>
          ${pendingUsers.length ? `<div class="hits">${pendingUsers.map((u) => `<div class="hit"><span><b>${esc(u.name)}</b> <span class="muted">${esc(u.email)}</span> asks to join as <b>${esc(countryName(u.country))}</b></span>
            <span><button class="btn small primary" data-act="user-approve" data-id="${esc(u.id)}">Approve</button> <button class="btn small" data-act="user-delete" data-id="${esc(u.id)}">Decline</button></span></div>`).join("")}</div>` : `<div class="muted">No pending requests.</div>`}
          <form class="f" data-form="new-user"><div class="frow"><label class="fl">Full name<input type="text" name="name" id="nu-name" required maxlength="100"></label>
            <label class="fl">Email<input type="email" name="email" id="nu-email" required maxlength="160"></label>
            <label class="fl">Role<select name="role" id="nu-role"><option value="CENTRAL">Central Secretariat</option>${COUNTRIES.map(([c, n]) => `<option value="${c}">${n} Secretariat</option>`).join("")}</select></label></div>
            <div class="factions"><button class="btn primary" type="submit">Create account</button></div></form>
          ${S.newPw ? `<div class="note"><b>Temporary password for ${esc(S.newPw.name)}:</b> <code class="pw" id="new-pw">${esc(S.newPw.password)}</code> <button class="btn small" data-act="copy-pw">Copy</button>
            <span class="muted" style="display:block;margin-top:4px">Shown only once. Share it privately; they set their own password at first sign-in.</span></div>` : ""}
          ${otherUsers.length ? `<div class="tablebox"><table><thead><tr><th>Person</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>${otherUsers.map((u) => `<tr>
            <td><b>${esc(u.name)}</b><span class="sub">${esc(u.email)}</span></td>
            <td><select data-change="user-role" data-id="${esc(u.id)}" aria-label="Role" ${u.id === S.uid ? "disabled" : ""}><option value="CENTRAL" ${u.role === "central" ? "selected" : ""}>Central Secretariat</option>${COUNTRIES.map(([c, n]) => `<option value="${c}" ${u.role === "country" && u.country === c ? "selected" : ""}>${n}${isHost(c) ? " (host)" : ""}</option>`).join("")}</select></td>
            <td><span class="pill ${u.status === "active" ? "good" : u.status === "disabled" ? "bad" : "warn"}">${esc(u.status)}</span>${u.lastLogin ? `<span class="sub">Last in ${fmtWhen(u.lastLogin)}</span>` : ""}</td>
            <td style="white-space:nowrap">${u.id === S.uid ? `<span class="muted">You</span>` : `<button class="btn small" data-act="user-reset" data-id="${esc(u.id)}">Reset password</button> <button class="btn small" data-act="user-toggle" data-id="${esc(u.id)}">${u.status === "disabled" ? "Enable" : "Disable"}</button> <button class="btn small danger" data-act="user-delete" data-id="${esc(u.id)}">Delete</button>`}</td></tr>`).join("")}</tbody></table></div>` : ""}
          <div class="muted" style="font-size:.9rem">Central Secretariat accounts see this tab and can act for any country. Country Secretariat accounts manage only their own country; host countries also get the Host desk.</div></div>
      </div>
      <div class="panel"><div class="panel-head"><h2>Demand vs capacity</h2><span class="muted">Active entries exclude Withdrawn and Reserve</span></div>
        ${live.length ? `<div class="tablebox"><table><thead><tr><th>Host</th><th>Skill</th><th class="num">Min</th><th class="num">Max</th><th class="num">Entries</th><th class="num">Countries</th><th class="num">Accepted</th><th>Demand</th><th>Rule to apply</th><th>Status</th></tr></thead><tbody>
          ${live.map((s) => { const d = demand(s); return `<tr class="click" data-act="open-skill" data-id="${esc(s.id)}" tabindex="0"><td><span class="host">${esc(s.host)}</span></td><td><b>${esc(s.name)}</b></td><td class="num">${d.min || "—"}</td><td class="num">${d.max || "—"}</td><td class="num">${d.n}</td><td class="num">${d.countries}</td><td class="num">${d.accepted}${d.min ? `/${d.min}` : ""}</td><td><span class="pill ${d.cls}">${esc(d.label)}</span></td><td>${esc(d.rule)}</td><td>${statusPill(s.status)}${d.hint ? `<span class="sub">${esc(d.hint)}</span>` : ""}</td></tr>`; }).join("")}
          </tbody></table></div>` : `<div class="empty">No skills yet.</div>`}</div>
      <div class="panel"><div class="panel-head"><h2>Entry decisions</h2><span class="muted">Set each entry's decision; edit an entry to change its stage</span></div>
        ${entries.length ? entryTable(entries, { showSkill: true, decide: true }) : `<div class="empty">No entries yet. Country Secretariats add them from their entries page.</div>`}</div>
      <div class="grid2">
        <div class="panel"><h2>Delegation registration</h2>
          <form class="f" data-form="roles">
            <div class="frow"><label class="fl">Registration opens<input type="date" name="dOpen" id="dl-open" value="${esc((S.settings.delegationReg || {}).open)}"></label>
              <label class="fl">Registration closes<input type="date" name="dClose" id="dl-close" value="${esc((S.settings.delegationReg || {}).close)}"></label></div>
            <div class="tablebox"><table><thead><tr><th>Role</th><th class="num">Places per country</th><th>Remove</th></tr></thead><tbody>
              ${roles().map((r, i) => { const used = S.delegates.filter((d) => d.role === r.id).length; return `<tr><td><input type="hidden" name="rid-${i}" value="${esc(r.id)}"><input type="text" name="rname-${i}" id="rname-${i}" maxlength="60" value="${esc(r.name)}" aria-label="Role name" style="width:100%"></td>
                <td><input type="number" name="rmax-${i}" id="rmax-${i}" min="0" max="200" value="${esc(r.max)}" aria-label="Places" style="width:90px"></td>
                <td>${used ? `<span class="muted">${used} registered</span>` : `<label class="chk"><input type="checkbox" name="rdel-${i}" id="rdel-${i}"> Remove</label>`}</td></tr>`; }).join("")}
              ${[0, 1].map((k) => `<tr><td><input type="text" name="new-${k}" id="rnew-${k}" maxlength="60" placeholder="New role, e.g. Interpreter" aria-label="New role name" style="width:100%"></td><td><input type="number" name="newmax-${k}" id="rnewmax-${k}" min="0" max="200" placeholder="0" aria-label="Places" style="width:90px"></td><td></td></tr>`).join("")}
            </tbody></table></div>
            <input type="hidden" name="rcount" value="${roles().length}">
            <p class="muted" style="margin:0;font-size:.9rem">A role with people registered can't be removed; ask the countries to remove them first. Lowering a number below what a country already registered flags it on their page.</p>
            <div class="factions"><button class="btn primary" type="submit">Save delegation settings</button></div></form></div>
        <div class="panel"><h2>Delegations by country</h2>
          <div class="tablebox"><table><thead><tr><th>Country</th>${roles().map((r) => `<th class="num">${esc(r.name)}</th>`).join("")}<th class="num">Total</th></tr></thead><tbody>
            ${COUNTRIES.map(([c, n]) => { const mine = S.delegates.filter((d) => d.country === c); return `<tr><td>${esc(n)}</td>${roles().map((r) => { const k = mine.filter((d) => d.role === r.id).length; return `<td class="num"${k > r.max ? ' style="color:var(--bad);font-weight:700"' : ""}>${k}/${esc(r.max)}</td>`; }).join("")}<td class="num"><b>${mine.length}</b></td></tr>`; }).join("")}
          </tbody></table></div>
          <div class="muted" style="font-size:.9rem">Use "Acting for" to open a country's delegation and see names.</div></div>
      </div>
      <div class="panel"><h2>Activity log</h2>
        ${S.log.length ? `<div class="tablebox"><table><thead><tr><th>When</th><th>Who</th><th>As</th><th>What</th></tr></thead><tbody>${S.log.map((l) => `<tr><td class="num" style="white-space:nowrap">${fmtWhen(l.at)}</td><td>${esc(nameOf(l.by))}</td><td>${esc(asLabel(l.as))}</td><td><b>${esc(l.action)}</b> <span class="muted">${esc(l.detail)}</span></td></tr>`).join("")}</tbody></table></div>` : `<div class="muted">No activity yet.</div>`}</div>`;
  }

  /* ---------- modal & forms ---------- */
  function openModal(html) { const m = $("#modal"); m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`; m.hidden = false; }
  function closeModal() { const m = $("#modal"); m.hidden = true; m.innerHTML = ""; S.openSkill = null; S.pendingDel = null; if (S.deferred) setTimeout(scheduleRefresh, 0); }
  function formSheet(title, sub, body) {
    S.openSkill = null;
    openModal(`<div class="sheet-head"><div><h2>${esc(title)}</h2>${sub ? `<span style="color:var(--band-muted)">${esc(sub)}</span>` : ""}</div><button class="x" data-act="close">Close</button></div><div class="sheet-body">${body}</div>`);
    const first = $("#modal input, #modal select, #modal textarea"); if (first) first.focus();
  }
  const opt = (list, cur) => list.map((v) => `<option ${v === cur ? "selected" : ""}>${esc(v)}</option>`).join("");

  function skillForm(sk) {
    const isNew = !sk; sk = sk || { host: myCountry(), status: "Proposed", type: "Individual", open: true };
    const statuses = S.isCentral ? SKILL_STATUS : (sk.status === "Proposed" || sk.status === "Withdrawn" ? ["Proposed", "Withdrawn"] : [sk.status, "Withdrawn"]);
    formSheet(isNew ? "Add skill" : "Edit skill", countryName(sk.host), `<form class="f" data-form="skill" data-id="${esc(sk.id || "")}">
      <input type="hidden" name="host" value="${esc(sk.host)}">
      <label class="fl">Skill name<input type="text" name="name" id="sk-name" required maxlength="80" value="${esc(sk.name)}"></label>
      <div class="frow"><label class="fl">Type<select name="type" id="sk-type">${opt(["Individual", "Team"], sk.type)}</select></label>
        <label class="fl">Team size <small>team skills only</small><input type="number" min="2" max="10" name="teamSize" id="sk-team" value="${esc(sk.teamSize)}"></label>
        <label class="fl">Status<select name="status" id="sk-status">${opt(statuses, sk.status)}</select></label></div>
      <p class="muted" style="margin:0;font-size:.9rem">${SKILL_STATUS.map((st) => `<b>${st}</b>: ${esc(STATUS_HELP[st])}`).join(" ")}${S.isCentral ? "" : " Only the Central Secretariat sets Official or Demo Skill."}</p>
      <div class="frow"><label class="fl">City<input type="text" name="city" id="sk-city" maxlength="60" value="${esc(sk.city)}"></label><label class="fl">Venue<input type="text" name="venue" id="sk-venue" maxlength="120" value="${esc(sk.venue)}"></label></div>
      <div class="frow"><label class="fl">Competition start (C1)<input type="date" name="c1" id="sk-c1" value="${esc(sk.c1)}" min="${esc(S.settings.windowStart)}" max="${esc(S.settings.windowEnd)}"></label>
        <label class="fl">Competition end (C3)<input type="date" name="c3" id="sk-c3" value="${esc(sk.c3)}" min="${esc(S.settings.windowStart)}" max="${esc(S.settings.windowEnd)}"></label></div>
      <div class="frow"><label class="fl">Workstations available<input type="number" min="0" max="500" name="workstations" id="sk-ws" value="${esc(sk.workstations)}"></label>
        <label class="fl">Minimum entries <small>${sk.type === "Team" ? "teams" : "competitors or teams"}</small><input type="number" min="0" max="500" name="min" id="sk-min" value="${esc(sk.min)}"></label>
        <label class="fl">Maximum entries<input type="number" min="0" max="500" name="max" id="sk-max" value="${esc(sk.max)}"></label></div>
      <div class="frow"><label class="fl">Infrastructure list<select name="infra" id="sk-infra">${opt(["", "Ready", "In progress", "Not started"], sk.infra || "")}</select></label>
        <label class="fl">Consumables provided by host<select name="consumables" id="sk-cons">${opt(["", "Yes", "Partly", "No"], sk.consumables || "")}</select></label></div>
      <div class="frow"><label class="fl">Technical lead <small>name, email</small><input type="text" name="techLead" id="sk-tl" maxlength="120" value="${esc(sk.techLead)}"></label>
        <label class="fl">Workshop manager <small>name, email</small><input type="text" name="workshopManager" id="sk-wm" maxlength="120" value="${esc(sk.workshopManager)}"></label></div>
      <label class="fl">Technical gaps<textarea name="gaps" id="sk-gaps" maxlength="600">${esc(sk.gaps)}</textarea></label>
      <label class="fl">Notes<textarea name="notes" id="sk-notes" maxlength="600">${esc(sk.notes)}</textarea></label>
      ${S.isCentral ? `<label class="chk"><input type="checkbox" name="open" id="sk-open" ${sk.open !== false ? "checked" : ""}> Open for entries</label>` : ""}
      <p class="err" id="form-err" hidden></p>
      <div class="factions"><button type="button" class="btn" data-act="close">Cancel</button><button class="btn primary" type="submit">${isNew ? "Add skill" : "Save skill"}</button></div></form>`);
  }
  function entryForm(e, skillId) {
    const c = e ? e.country : myCountry(); const isNew = !e; const cur = currentStage();
    if (isNew && !cur) { toast("Registration is closed. New entries can be added only while a registration stage is open."); return; }
    if (!isNew && !S.isCentral && !cur) { toast("Registration is closed. Entries can be changed only while a registration stage is open."); return; }
    e = e || { skillId: skillId || "", stage: cur || "Interest", decision: "Pending" };
    const open = S.skills.filter((s) => (s.open !== false && s.status !== "Withdrawn") || s.id === e.skillId).sort((a, b) => (a.host || "").localeCompare(b.host || "") || (a.name || "").localeCompare(b.name || ""));
    const hosts = [...new Set(open.map((s) => s.host))];
    // The stage is never chosen by hand: a new entry takes the stage now open; an edit during a later stage moves the entry forward to it.
    const stageNow = isNew ? cur : (cur && STAGES.indexOf(cur) > STAGES.indexOf(e.stage || "Interest") ? cur : (e.stage || "Interest"));
    formSheet(isNew ? "Add entry" : "Edit entry", countryName(c), `<form class="f" data-form="entry" data-id="${esc(e.id || "")}">
      <input type="hidden" name="country" value="${esc(c)}">
      <label class="fl">Skill<select name="skillId" id="en-skill" required ${isNew ? "" : "disabled"}><option value="">Choose a skill…</option>
        ${hosts.map((h) => `<optgroup label="${esc(countryName(h))}">${open.filter((s) => s.host === h).map((s) => { const d = demand(s); return `<option value="${esc(s.id)}" ${s.id === e.skillId ? "selected" : ""}>${esc(s.name)}${d.left !== null ? ` · ${d.left >= 0 ? d.left + " places left" : "over capacity"}` : ""}</option>`; }).join("")}</optgroup>`).join("")}</select></label>
      ${!isNew ? `<input type="hidden" name="skillId" value="${esc(e.skillId)}">` : ""}
      <div class="note"><b>Stage: ${esc(stageNow)}</b>${!isNew && stageNow !== e.stage ? ` (moves from ${esc(e.stage)} when you save)` : ""}${cur ? ` · open until ${fmtDate(reg()[cur].close)}` : " · registration closed"}. <span class="muted">${esc(STAGE_HELP[stageNow])}</span></div>
      ${S.isCentral && !isNew ? `<label class="fl">Decision<select name="decision" id="en-dec">${opt(DECISIONS, decisionOf(e))}</select></label>` : ""}
      <label class="fl">Competitor name(s) <small>For a team, separate names with commas. Required at the Definitive stage.</small><input type="text" name="competitors" id="en-comp" maxlength="200" value="${esc(e.competitors)}"></label>
      <label class="fl">Expert name <small>Required at the Definitive stage.</small><input type="text" name="expert" id="en-exp" maxlength="100" value="${esc(e.expert)}"></label>
      <label class="fl">Notes<textarea name="notes" id="en-notes" maxlength="500">${esc(e.notes)}</textarea></label>
      <p class="muted" style="margin:0;font-size:.9rem">Collect only what the registration needs. Competitor names are visible to your country, the host of this skill, and the Central Secretariat.</p>
      <p class="err" id="form-err" hidden></p>
      <div class="factions"><button type="button" class="btn" data-act="close">Cancel</button><button class="btn primary" type="submit">${isNew ? "Add entry" : "Save entry"}</button></div></form>`);
  }
  function delegateForm(d, roleId) {
    const isNew = !d; const c = d ? d.country : myCountry();
    if (!S.isCentral && !delegOpen()) { toast("Delegation registration is closed."); return; }
    d = d || { role: roleId, country: c };
    formSheet(isNew ? `Add ${roleName(d.role)}` : `Edit ${roleName(d.role)}`, countryName(c), `<form class="f" data-form="delegate" data-id="${esc(d.id || "")}">
      <input type="hidden" name="country" value="${esc(c)}"><input type="hidden" name="role" value="${esc(d.role)}">
      <label class="fl">Full name<input type="text" name="name" id="dg-name" required maxlength="100" value="${esc(d.name)}"></label>
      <label class="fl">Position and organisation<input type="text" name="position" id="dg-pos" maxlength="150" value="${esc(d.position)}"></label>
      <div class="frow"><label class="fl">Email<input type="text" name="email" id="dg-email" maxlength="120" value="${esc(d.email)}"></label><label class="fl">Phone<input type="text" name="phone" id="dg-phone" maxlength="40" value="${esc(d.phone)}"></label></div>
      <label class="fl">Notes<textarea name="notes" id="dg-notes" maxlength="400">${esc(d.notes)}</textarea></label>
      <p class="muted" style="margin:0;font-size:.9rem">Visible to your country's secretariat and the Central Secretariat.</p>
      <p class="err" id="form-err" hidden></p>
      <div class="factions"><button type="button" class="btn" data-act="close">Cancel</button><button class="btn primary" type="submit">${isNew ? "Add" : "Save"}</button></div></form>`);
  }
  function hostForm(c) {
    const h = S.hosts[c] || {};
    formSheet("Host information", countryName(c), `<form class="f" data-form="host" data-id="${esc(c)}">
      <label class="fl">Host Secretariat contact <small>name and position</small><input type="text" name="contact" id="ho-contact" maxlength="120" value="${esc(h.contact)}"></label>
      <div class="frow"><label class="fl">Email<input type="text" name="email" id="ho-email" maxlength="120" value="${esc(h.email)}"></label><label class="fl">Phone<input type="text" name="phone" id="ho-phone" maxlength="40" value="${esc(h.phone)}"></label></div>
      <label class="fl">Host cities<input type="text" name="cities" id="ho-cities" maxlength="120" value="${esc(h.cities)}"></label>
      <label class="fl">Announcement <small>shown to all secretariats</small><textarea name="announcement" id="ho-ann" maxlength="600">${esc(h.announcement)}</textarea></label>
      <div class="factions"><button type="button" class="btn" data-act="close">Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`);
  }
  function uploadForm(scope, id) {
    const where = scope === "skill" ? (skillById(id) || {}).name : scope === "host" ? countryName(id) + " host" : "entry";
    formSheet("Upload document", where, `<form class="f" data-form="upload" data-scope="${esc(scope)}" data-id="${esc(id)}">
      <label class="fl">Document type<select name="kind" id="up-kind">${opt(DOC_KINDS[scope], "")}</select></label>
      <label class="fl">Title <small>optional; defaults to the file name</small><input type="text" name="title" id="up-title" maxlength="120"></label>
      <label class="fl">File <small>PDF, image, CSV or text, up to 20 MB. Save Word or Excel files as PDF first.</small><input type="file" name="file" id="up-file" accept="${ACCEPT}" required></label>
      <p class="err" id="form-err" hidden></p>
      <div class="factions"><button type="button" class="btn" data-act="close">Cancel</button><button class="btn primary" type="submit" id="up-go">Upload</button></div></form>`);
  }
  function entryDocsSheet(id) {
    const e = S.entries.find((x) => x.id === id); if (!e) return;
    const sk = skillById(e.skillId) || {}; const ed = canEditEntry(e);
    formSheet("Entry documents", `${countryName(e.country)} · ${sk.name || ""}`, `<div class="panel"><div class="panel-head"><h3>${esc(e.competitors || "Competitor TBC")}</h3>${ed ? `<button class="btn small" data-act="upload" data-scope="entry" data-id="${esc(e.id)}">Upload</button>` : ""}</div>${docList(e.docs, "entry", e.id, ed)}</div>`);
  }
  function formErr(msg) { const p = $("#form-err"); if (p) { p.textContent = msg; p.hidden = false; } }

  async function onSubmit(form) {
    const fd = new FormData(form), kind = form.dataset.form, id = form.dataset.id;
    const v = (k) => String(fd.get(k) || "").trim();
    const n = (k) => (v(k) === "" ? "" : Number(v(k)));
    const btn = form.querySelector('button[type="submit"]');
    const hold = async (p) => { if (btn) btn.disabled = true; try { return await p; } finally { if (btn) btn.disabled = false; } };
    if (kind === "login") {
      const ok = await hold(api("POST", "/api/auth/login", { email: v("email"), password: String(fd.get("password") || "") }, "", { auth: true }));
      if (ok) startLive();
      return;
    }
    if (kind === "signup") {
      if (String(fd.get("password") || "").length < 10) return formErr("Use a password of at least 10 characters.");
      const ok = await hold(api("POST", "/api/auth/register", { name: v("name"), email: v("email"), password: String(fd.get("password") || ""), country: v("country") }, "Request sent to the Central Secretariat", { auth: true }));
      if (ok) startLive();
      return;
    }
    if (kind === "password") {
      if (fd.get("next") !== fd.get("again")) return formErr("The new passwords don't match.");
      if (await hold(api("POST", "/api/auth/password", { current: String(fd.get("current") || ""), next: String(fd.get("next") || "") }, "Password changed"))) { S.pwPrompted = true; closeModal(); render(); }
      return;
    }
    if (kind === "new-user") {
      const r = v("role");
      const res = await hold(api("POST", "/api/users", { name: v("name"), email: v("email"), role: r === "CENTRAL" ? "central" : "country", country: r === "CENTRAL" ? "" : r }, "Account created"));
      if (res) { S.newPw = { name: v("name"), password: res.password }; render(); }
      return;
    }
    if (kind === "settings") {
      const hosts = fd.getAll("host");
      if (v("windowStart") && v("windowEnd") && v("windowEnd") < v("windowStart")) { toast("The window must close after it opens."); return; }
      const registration = {};
      for (const st of STAGES) {
        const o = v(st + "-open"), c = v(st + "-close");
        if ((o && !c) || (!o && c)) { toast(`Set both dates for the ${st} stage, or neither.`); return; }
        if (o && c && c < o) { toast(`The ${st} stage must close after it opens.`); return; }
        registration[st] = { open: o, close: c };
      }
      await hold(api("PUT", "/api/settings", { windowStart: v("windowStart"), windowEnd: v("windowEnd"), hostCountries: hosts, registration }, "Settings saved"));
      return;
    }
    if (kind === "skill") {
      const data = { host: v("host"), name: v("name"), type: v("type"), teamSize: v("type") === "Team" ? n("teamSize") : "", status: v("status") || "Proposed", city: v("city"), venue: v("venue"),
        c1: v("c1"), c3: v("c3"), workstations: n("workstations"), min: n("min"), max: n("max"), infra: v("infra"), consumables: v("consumables"),
        techLead: v("techLead"), workshopManager: v("workshopManager"), gaps: v("gaps"), notes: v("notes") };
      if (!data.name) return formErr("Enter the skill name.");
      if (data.min !== "" && data.max !== "" && data.min > data.max) return formErr("Minimum entries can't be more than the maximum.");
      if (data.max !== "" && data.workstations !== "" && data.max > data.workstations) return formErr("Maximum entries can't be more than the workstations available.");
      if (data.c1 && data.c3 && data.c3 < data.c1) return formErr("C3 must be on or after C1.");
      if (S.isCentral) data.open = fd.get("open") === "on";
      const res = await hold(api(id ? "PUT" : "POST", id ? `/api/skills/${encodeURIComponent(id)}` : "/api/skills", data, id ? "Skill saved" : "Skill added"));
      if (res) { closeModal(); render(); if (res.note) toast("Note: " + res.note); }
      return;
    }
    if (kind === "entry") {
      const skillId = v("skillId"); if (!skillId) return formErr("Choose a skill.");
      const country = v("country");
      if (!id && S.entries.some((x) => x.skillId === skillId && x.country === country && decisionOf(x) !== "Withdrawn") && !confirmTwo(form)) return formErr("Your country already has an entry in this skill. A second entry is allowed only if the skill is below its minimum or the OCM approves it. Select Add entry again to add it anyway.");
      const body = { skillId, country, competitors: v("competitors"), expert: v("expert"), notes: v("notes") };
      if (S.isCentral && id && v("decision")) body.decision = v("decision");
      const res = await hold(api(id ? "PUT" : "POST", id ? `/api/entries/${encodeURIComponent(id)}` : "/api/entries", body, id ? "Entry saved" : "Entry added"));
      if (res) { closeModal(); render(); }
      return;
    }
    if (kind === "delegate") {
      if (!v("name")) return formErr("Enter the full name.");
      if (v("email") && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v("email"))) return formErr("Check the email address.");
      const body = { country: v("country"), role: v("role"), name: v("name"), position: v("position"), email: v("email"), phone: v("phone"), notes: v("notes") };
      const res = await hold(api(id ? "PUT" : "POST", id ? `/api/delegates/${encodeURIComponent(id)}` : "/api/delegates", body, id ? "Saved" : `${roleName(v("role"))} added`));
      if (res) { closeModal(); render(); }
      return;
    }
    if (kind === "roles") {
      const out = [], count = Number(v("rcount")) || 0;
      for (let i = 0; i < count; i++) {
        if (fd.get("rdel-" + i) === "on") continue;
        out.push({ id: v("rid-" + i), name: v("rname-" + i), max: Number(v("rmax-" + i)) });
      }
      for (const k of [0, 1]) { const name = v("new-" + k); if (name) out.push({ name, max: Number(v("newmax-" + k) || 0) }); }
      await hold(api("PUT", "/api/settings/delegation", { roles: out, delegationReg: { open: v("dOpen"), close: v("dClose") } }, "Delegation settings saved"));
      return;
    }
    if (kind === "host") {
      const res = await hold(api("PUT", `/api/hosts/${encodeURIComponent(id)}`, { contact: v("contact"), email: v("email"), phone: v("phone"), cities: v("cities"), announcement: v("announcement") }, "Host information saved"));
      if (res) { closeModal(); render(); }
      return;
    }
    if (kind === "upload") {
      const file = fd.get("file"); if (!file || !file.size) return formErr("Choose a file.");
      const ext = (file.name.split(".").pop() || "").toLowerCase(); const type = TYPE_BY_EXT[ext];
      if (!type) return formErr("This file type isn't supported. Save it as PDF and upload again.");
      if (file.size > 20 * 1024 * 1024) return formErr("The file is over 20 MB. Compress it or split it.");
      const scope = form.dataset.scope;
      const qs = new URLSearchParams({ scope, target: id, kind: v("kind"), name: v("title") || file.name });
      btn.textContent = "Uploading…";
      const res = await hold(api("POST", `/api/files?${qs}`, file, "Document uploaded", { raw: true, type }));
      btn.textContent = "Upload";
      if (res) { closeModal(); if (scope === "skill") S.openSkill = id; render(); if (scope === "entry") entryDocsSheet(id); }
    }
  }
  function confirmTwo(form) { if (form.dataset.confirmed === "1") return true; form.dataset.confirmed = "1"; return false; }

  async function removeDoc(key) {
    const [scope, id, fileId] = key.split("|"); S.pendingDel = null;
    await api("DELETE", `/api/files/${encodeURIComponent(fileId)}`, undefined, "Document removed");
    if (scope === "entry") entryDocsSheet(id); else render();
  }
  function passwordForm(forced) {
    formSheet("Change password", forced ? "Set your own password before you continue" : S.me.email, `<form class="f" data-form="password">
      <label class="fl">Current password${forced ? " <small>the temporary password you were given</small>" : ""}<input type="password" name="current" id="pw-cur" required autocomplete="current-password"></label>
      <label class="fl">New password <small>at least 10 characters</small><input type="password" name="next" id="pw-new" required minlength="10" autocomplete="new-password"></label>
      <label class="fl">Repeat new password<input type="password" name="again" id="pw-again" required minlength="10" autocomplete="new-password"></label>
      <p class="err" id="form-err" hidden></p>
      <div class="factions">${forced ? "" : `<button type="button" class="btn" data-act="close">Cancel</button>`}<button class="btn primary" type="submit">Change password</button></div></form>`);
  }

  /* ---------- events ---------- */
  document.addEventListener("click", async (ev) => {
    const t = ev.target.closest("[data-act]"); if (!t) { if (ev.target.id === "modal" && !(S.me && S.me.mustChange)) closeModal(); return; }
    const a = t.dataset.act, id = t.dataset.id;
    const confirmOnce = (label) => { if (t.dataset.sure === "1") return true; t.dataset.sure = "1"; t.textContent = label; return false; };
    if (a === "close") { closeModal(); render(); }
    else if (a === "auth-switch") { S.authView = S.authView === "signup" ? "login" : "signup"; render(); }
    else if (a === "logout") { await api("POST", "/api/auth/logout", {}, "", { noRefresh: true, auth: true }); stopLive(); S.me = null; S.actingAs = ""; S.newPw = null; S.pwPrompted = false; closeModal(); location.hash = ""; render(); }
    else if (a === "password") passwordForm(false);
    else if (a === "open-skill") { S.openSkill = id; renderSkillSheet(); }
    else if (a === "f-host") { S.filter.host = t.dataset.v; render(true); }
    else if (a === "add-skill") skillForm(null);
    else if (a === "edit-skill") skillForm(skillById(id));
    else if (a === "add-entry") { if (!canAddEntries()) { toast(currentStage() ? "Your account can't add entries yet." : "Registration is closed."); return; } entryForm(null, t.dataset.skill); }
    else if (a === "edit-entry") entryForm(S.entries.find((x) => x.id === id));
    else if (a === "entry-docs") entryDocsSheet(id);
    else if (a === "add-delegate") delegateForm(null, t.dataset.role);
    else if (a === "edit-delegate") delegateForm(S.delegates.find((x) => x.id === id));
    else if (a === "del-delegate") { if (!confirmOnce("Confirm remove")) return; await api("DELETE", `/api/delegates/${encodeURIComponent(id)}`, undefined, "Removed"); }
    else if (a === "withdraw") { if (!confirmOnce("Confirm withdraw")) return; await api("POST", `/api/entries/${encodeURIComponent(id)}/withdraw`, {}, "Entry withdrawn"); }
    else if (a === "edit-host") hostForm(myCountry());
    else if (a === "upload") uploadForm(t.dataset.scope, id);
    else if (a === "doc-del") { S.pendingDel = t.dataset.key; const sc = t.dataset.key.split("|"); if (sc[0] === "entry") entryDocsSheet(sc[1]); else render(true); }
    else if (a === "doc-del-cancel") { const k = S.pendingDel || ""; S.pendingDel = null; const sc = k.split("|"); if (sc[0] === "entry") entryDocsSheet(sc[1]); else render(true); }
    else if (a === "doc-del-confirm") removeDoc(t.dataset.key);
    else if (a === "user-approve") await api("PUT", `/api/users/${encodeURIComponent(id)}`, { status: "active" }, "Account approved");
    else if (a === "user-toggle") { const u = S.users.find((x) => x.id === id); if (!u) return; await api("PUT", `/api/users/${encodeURIComponent(id)}`, { status: u.status === "disabled" ? "active" : "disabled" }, u.status === "disabled" ? "Account enabled" : "Account disabled"); }
    else if (a === "user-reset") { if (!confirmOnce("Confirm reset")) return; const u = S.users.find((x) => x.id === id); const res = await api("POST", `/api/users/${encodeURIComponent(id)}/reset-password`, {}, "Password reset"); if (res) { S.newPw = { name: u ? u.name : "this account", password: res.password }; render(); } }
    else if (a === "user-delete") { if (!confirmOnce("Confirm")) return; await api("DELETE", `/api/users/${encodeURIComponent(id)}`, undefined, "Account removed"); }
    else if (a === "copy-pw") {
      const el = $("#new-pw"); if (!el) return;
      try { await navigator.clipboard.writeText(el.textContent); toast("Copied"); }
      catch (e) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast("Selected. Press Ctrl+C to copy."); }
    }
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !$("#modal").hidden) { closeModal(); render(); }
    if ((ev.key === "Enter" || ev.key === " ") && ev.target.matches("tr[data-act]")) { ev.preventDefault(); ev.target.click(); }
  });
  document.addEventListener("submit", (ev) => { const f = ev.target.closest("form[data-form]"); if (!f) return; ev.preventDefault(); onSubmit(f); });
  document.addEventListener("change", async (ev) => {
    const t = ev.target; const k = t.dataset && t.dataset.change; if (!k) return;
    if (k === "acting") { S.actingAs = t.value; try { localStorage.setItem("ws27-acting", S.actingAs); } catch (e) {} render(); }
    else if (k === "f-status") { S.filter.status = t.value; $("#skill-list").innerHTML = skillRows(); }
    else if (k === "decision") { const e = S.entries.find((x) => x.id === t.dataset.id); if (!e || decisionOf(e) === t.value) return;
      if (!(await api("POST", `/api/entries/${encodeURIComponent(e.id)}/decision`, { decision: t.value }, `Decision set to ${t.value}`))) t.value = decisionOf(e); }
    else if (k === "user-role") { const val = t.value;
      await api("PUT", `/api/users/${encodeURIComponent(t.dataset.id)}`, val === "CENTRAL" ? { role: "central" } : { role: "country", country: val }, "Role updated"); }
  });
  document.addEventListener("input", (ev) => {
    const t = ev.target;
    if (t.id === "f-q") { S.filter.q = t.value; $("#skill-list").innerHTML = skillRows(); }
  });
  window.addEventListener("hashchange", () => { S.view = (location.hash || "#skills").slice(1); closeModal(); render(true); window.scrollTo(0, 0); });
  S.view = (location.hash || "#skills").slice(1);

  /* ---------- boot ---------- */
  document.addEventListener("focusout", () => setTimeout(() => { if (S.deferred && !busyTyping() && $("#modal").hidden) scheduleRefresh(); }, 60));
  setInterval(() => { if (S.me && document.visibilityState === "visible") scheduleRefresh(); }, 10 * 60 * 1000);
  render();
  refresh().then(() => startLive());
})();
