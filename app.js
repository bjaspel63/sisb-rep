// app.js — Firestore database + Teacher PIN (no Firebase Auth)
// PW is protected: blurred by default + 👁 toggle, asks teacher PIN to reveal.
// Add/Edit/Delete also require teacher PIN (can be changed).

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore, collection, doc, setDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/** =========================
 *  FIREBASE CONFIG
 *  ========================= */
const firebaseConfig = {
  apiKey: "AIzaSyAF50UAawqFWXREMtbk7DcE8BCPAZgA_i0",
  authDomain: "sisb-rep.firebaseapp.com",
  projectId: "sisb-rep",
  storageBucket: "sisb-rep.firebasestorage.app",
  messagingSenderId: "435697746373",
  appId: "1:435697746373:web:43fe4a995de3b77a8b0bac",
  measurementId: "G-FY6Y7LQSKF"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

/** =========================
 *  TEACHER PIN (LOCAL ONLY)
 *  =========================
 *  - This PIN protects PW reveal + edits.
 *  - Stored as SHA-256 hash in localStorage.
 *  - This is NOT bank-level security (it’s classroom privacy).
 */
const PIN_HASH_KEY = "teacher_pin_hash_v1";
const UNLOCK_KEY = "teacher_unlocked_v1";

// Color mapping (only red/blue/yellow)
const COLOR_MAP = {
  red: "#ef4444",
  blue: "#3b82f6",
  yellow: "#f59e0b"
};

function norm(s){ return (s ?? "").toString().trim(); }
function safeLower(s){ return norm(s).toLowerCase(); }
function toIntOrNull(v){
  const s = norm(v);
  if(!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function escapeHtml(s){
  return (s ?? "").toString().replace(/[&<>"']/g, (c)=>({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[c]));
}

async function sha256(text){
  const enc = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
function hasPin(){ return !!localStorage.getItem(PIN_HASH_KEY); }
function isUnlocked(){ return localStorage.getItem(UNLOCK_KEY) === "1"; }
function setUnlocked(v){ localStorage.setItem(UNLOCK_KEY, v ? "1" : "0"); }

window.addEventListener("DOMContentLoaded", () => {
  console.log("app.js loaded ✅ (no auth)");

  const $ = (id) => document.getElementById(id);

  // Hide old auth UI if still in HTML
  $("authBadge")?.remove();
  $("loginBtn")?.remove();
  $("logoutBtn")?.remove();
  $("loginModal")?.remove();

  // UI refs
  const studentForm = $("studentForm");
  const formTitle = $("formTitle");
  const saveBtn = $("saveBtn");
  const cancelEditBtn = $("cancelEditBtn");

  const nameEl = $("name");
  const sectionEl = $("section");
  const emailEl = $("email");
  const pwEl = $("pw"); // input (teacher-only)
  const noteEl = $("note");
  const chromebookEl = $("chromebook");
  const seatEl = $("seat");
  const tableColorEl = $("tableColor");
  const colorSwatch = $("colorSwatch");

  const tbody = $("tbody");
  const searchInput = $("searchInput");
  const sortSelect = $("sortSelect");
  const countLine = $("countLine");

  // Insert a small lock button in the header area (right side)
  const topbarActions = document.querySelector(".actions");
  const lockBtn = document.createElement("button");
  lockBtn.className = "btn ghost";
  lockBtn.id = "pinLockBtn";
  lockBtn.textContent = isUnlocked() ? "🔓 Teacher" : "🔒 Teacher";
  topbarActions?.appendChild(lockBtn);

  // PIN modal (created in JS so you don’t need to edit HTML)
  const pinModal = document.createElement("div");
  pinModal.className = "modal";
  pinModal.id = "pinModal";
  pinModal.hidden = true;
  pinModal.innerHTML = `
    <div class="modalCard">
      <div class="modalHead">
        <h3 id="pinTitle">Teacher Unlock</h3>
        <button id="pinCloseBtn" class="iconBtn" title="Close">✕</button>
      </div>

      <div class="grid onecol">
        <div class="field">
          <label for="pinInput">PIN</label>
          <input id="pinInput" type="password" inputmode="numeric" placeholder="••••" />
          <small class="hint" id="pinHint">Enter teacher PIN to unlock.</small>
        </div>

        <div class="field" id="pinConfirmWrap" style="display:none;">
          <label for="pinConfirmInput">Confirm PIN</label>
          <input id="pinConfirmInput" type="password" inputmode="numeric" placeholder="••••" />
        </div>
      </div>

      <div class="modalActions">
        <button id="pinPrimaryBtn" class="btn primary">Unlock</button>
        <button id="pinSecondaryBtn" class="btn ghost" style="display:none;">Cancel</button>
      </div>

      <small class="subtle">PIN is stored on this device only.</small>
    </div>
  `;
  document.body.appendChild(pinModal);

  const pinTitle = pinModal.querySelector("#pinTitle");
  const pinHint = pinModal.querySelector("#pinHint");
  const pinCloseBtn = pinModal.querySelector("#pinCloseBtn");
  const pinInput = pinModal.querySelector("#pinInput");
  const pinConfirmWrap = pinModal.querySelector("#pinConfirmWrap");
  const pinConfirmInput = pinModal.querySelector("#pinConfirmInput");
  const pinPrimaryBtn = pinModal.querySelector("#pinPrimaryBtn");
  const pinSecondaryBtn = pinModal.querySelector("#pinSecondaryBtn");

  let pinMode = "unlock"; // "unlock" | "set" | "change"

  function openPinModal(mode){
    pinMode = mode;
    pinInput.value = "";
    pinConfirmInput.value = "";

    // Decide UI
    if(mode === "set"){
      pinTitle.textContent = "Set Teacher PIN";
      pinHint.textContent = "Create a PIN for this device.";
      pinPrimaryBtn.textContent = "Set PIN";
      pinConfirmWrap.style.display = "";
      pinSecondaryBtn.style.display = "";
    }else if(mode === "change"){
      pinTitle.textContent = "Change Teacher PIN";
      pinHint.textContent = "Enter a new PIN for this device.";
      pinPrimaryBtn.textContent = "Change PIN";
      pinConfirmWrap.style.display = "";
      pinSecondaryBtn.style.display = "";
    }else{
      pinTitle.textContent = "Teacher Unlock";
      pinHint.textContent = "Enter teacher PIN to unlock.";
      pinPrimaryBtn.textContent = "Unlock";
      pinConfirmWrap.style.display = "none";
      pinSecondaryBtn.style.display = "none";
    }

    pinModal.hidden = false;
    pinInput.focus();
  }

  function closePinModal(){
    pinModal.hidden = true;
  }

  pinCloseBtn.addEventListener("click", closePinModal);
  pinSecondaryBtn.addEventListener("click", closePinModal);
  pinModal.addEventListener("click", (e)=>{
    if(e.target === pinModal) closePinModal();
  });

  lockBtn.addEventListener("click", ()=>{
    if(isUnlocked()){
      setUnlocked(false);
      lockBtn.textContent = "🔒 Teacher";
      applyLockUI();
      render();
      return;
    }
    if(!hasPin()) openPinModal("set");
    else openPinModal("unlock");
  });

  pinPrimaryBtn.addEventListener("click", async ()=>{
    const pin = norm(pinInput.value);
    if(pin.length < 4){
      alert("PIN must be at least 4 digits/characters.");
      return;
    }

    if(pinMode === "set" || pinMode === "change"){
      const confirmPin = norm(pinConfirmInput.value);
      if(confirmPin !== pin){
        alert("PIN confirmation does not match.");
        return;
      }
      const h = await sha256(pin);
      localStorage.setItem(PIN_HASH_KEY, h);
      setUnlocked(true);
      lockBtn.textContent = "🔓 Teacher";
      closePinModal();
      applyLockUI();
      render();
      alert(pinMode === "set" ? "PIN set. Unlocked!" : "PIN changed. Unlocked!");
      return;
    }

    // unlock mode
    const stored = localStorage.getItem(PIN_HASH_KEY);
    const h = await sha256(pin);
    if(h === stored){
      setUnlocked(true);
      lockBtn.textContent = "🔓 Teacher";
      closePinModal();
      applyLockUI();
      render();
    }else{
      alert("Wrong PIN.");
    }
  });

  // Data + state
  let records = [];            // students collection
  let editingId = null;

  // PW visibility cache
  const pwCache = new Map();   // id -> pw string
  const pwVisible = new Set(); // ids currently revealed

  function setColorUI(colorKey){
    const hex = COLOR_MAP[colorKey] || COLOR_MAP.red;
    if(colorSwatch) colorSwatch.style.background = hex;
  }

  tableColorEl?.addEventListener("change", ()=> setColorUI(tableColorEl.value));
  if(tableColorEl) setColorUI(tableColorEl.value);

  function applyLockUI(){
    const locked = !isUnlocked();

    // Disable form when locked (feel free to remove this if you want add/edit without unlock)
    [nameEl, sectionEl, emailEl, pwEl, noteEl, chromebookEl, seatEl, tableColorEl, saveBtn, cancelEditBtn]
      .forEach(el => { if(el) el.disabled = locked; });

    // Always blur/hide any shown PW when locked
    if(locked) pwVisible.clear();
  }

  // ---------- Firestore subscription ----------
  const studentsRef = collection(db, "students");
  const qStudents = query(studentsRef, orderBy("updatedAt", "desc"));

  onSnapshot(
    qStudents,
    (snap)=>{
      records = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      render();
    },
    (err)=>{
      console.error("Firestore snapshot error:", err);
      tbody.innerHTML = `
        <tr>
          <td colspan="9" style="padding:14px; color: rgba(234,240,255,.75);">
            ⚠️ Cannot read Firestore data. Check Firestore rules / index.<br/>
            <span style="opacity:.75; font-size:12px;">${escapeHtml(err?.message || "")}</span>
          </td>
        </tr>
      `;
    }
  );

  // ---------- Form ----------
  function resetForm(){
    editingId = null;
    if(formTitle) formTitle.textContent = "Add Student";
    if(saveBtn) saveBtn.textContent = "Save";
    if(cancelEditBtn) cancelEditBtn.hidden = true;

    studentForm?.reset();
    if(tableColorEl){
      tableColorEl.value = "red";
      setColorUI("red");
    }
  }

  cancelEditBtn?.addEventListener("click", resetForm);

  function getFormData(){
    return {
      name: norm(nameEl?.value),
      section: norm(sectionEl?.value),
      email: norm(emailEl?.value),
      note: norm(noteEl?.value),
      chromebookNumber: toIntOrNull(chromebookEl?.value),
      seatNumber: toIntOrNull(seatEl?.value),
      tableColor: norm(tableColorEl?.value) || "red"
    };
  }

  function getPw(){
    return norm(pwEl?.value); // may be blank
  }

  function validate(data){
    if(!data.name) return "Name is required.";
    if(!data.section) return "Section is required.";
    if(data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return "Email looks invalid.";
    if(!COLOR_MAP[data.tableColor]) return "Table color must be red, blue, or yellow.";
    return null;
  }

  async function requireTeacherUnlock(){
    if(isUnlocked()) return true;
    if(!hasPin()){
      openPinModal("set");
    }else{
      openPinModal("unlock");
    }
    return false;
  }

  // Create / Update documents:
  // - students/{id} : public fields
  // - pw_secrets/{id} : { pw } teacher-only (we still use a separate doc for separation)
  async function upsertStudent(id, data, pw){
    const ok = await requireTeacherUnlock();
    if(!ok) return;

    if(!id){
      const newRef = doc(collection(db, "students"));
      await setDoc(newRef, {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      await setDoc(doc(db, "pw_secrets", newRef.id), { pw: pw || "" });
      return;
    }

    await updateDoc(doc(db, "students", id), {
      ...data,
      updatedAt: serverTimestamp()
    });

    await setDoc(doc(db, "pw_secrets", id), { pw: pw || "" }, { merge: true });

    if(pwVisible.has(id)){
      pwCache.set(id, pw || "");
    }
  }

  studentForm?.addEventListener("submit", async (e)=>{
    e.preventDefault();

    const data = getFormData();
    const pw = getPw();
    const err = validate(data);
    if(err) return alert(err);

    try{
      await upsertStudent(editingId, data, pw);
      resetForm();
    }catch(e){
      alert("Save failed: " + (e?.message || "Unknown error"));
      console.error("Save error:", e);
    }
  });

  // ---------- Delete ----------
  async function deleteStudent(id){
    const ok = await requireTeacherUnlock();
    if(!ok) return;

    if(!confirm("Delete this record?")) return;
    try{
      await deleteDoc(doc(db, "students", id));
      await deleteDoc(doc(db, "pw_secrets", id));

      pwVisible.delete(id);
      pwCache.delete(id);
      if(editingId === id) resetForm();
    }catch(e){
      alert("Delete failed: " + (e?.message || "Unknown error"));
      console.error("Delete error:", e);
    }
  }

  // ---------- Edit ----------
  async function startEdit(id){
    const ok = await requireTeacherUnlock();
    if(!ok) return;

    const r = records.find(x => x.id === id);
    if(!r) return;

    editingId = id;
    if(formTitle) formTitle.textContent = "Edit Student";
    if(saveBtn) saveBtn.textContent = "Update";
    if(cancelEditBtn) cancelEditBtn.hidden = false;

    if(nameEl) nameEl.value = r.name ?? "";
    if(sectionEl) sectionEl.value = r.section ?? "";
    if(emailEl) emailEl.value = r.email ?? "";
    if(noteEl) noteEl.value = r.note ?? "";
    if(chromebookEl) chromebookEl.value = r.chromebookNumber ?? "";
    if(seatEl) seatEl.value = r.seatNumber ?? "";
    if(tableColorEl){
      tableColorEl.value = r.tableColor ?? "red";
      setColorUI(tableColorEl.value);
    }

    // For safety: don’t auto-fill PW
    if(pwEl) pwEl.value = "";

    nameEl?.focus();
  }

  // ---------- PW reveal ----------
  async function togglePw(id){
    // If already visible, hide without needing PIN
    if(pwVisible.has(id)){
      pwVisible.delete(id);
      render();
      return;
    }

    // Need teacher unlock to reveal
    const ok = await requireTeacherUnlock();
    if(!ok) return;

    try{
      const snap = await getDoc(doc(db, "pw_secrets", id));
      const pw = snap.exists() ? (snap.data().pw ?? "") : "";
      pwCache.set(id, pw);
      pwVisible.add(id);
      render();
    }catch(e){
      alert("Cannot reveal PW: " + (e?.message || "Unknown error"));
      console.error("Reveal PW error:", e);
    }
  }

  // ---------- Render ----------
  function matchesSearch(r, q){
    if(!q) return true;
    const blob = [r.name, r.section, r.email, r.note, r.chromebookNumber ?? "", r.seatNumber ?? ""]
      .join(" ")
      .toLowerCase();
    return blob.includes(q);
  }

  function compare(a, b, mode){
    const byStr = (x, y) => (x||"").localeCompare(y||"", undefined, { sensitivity:"base" });
    const byNum = (x, y) => (x ?? 1e15) - (y ?? 1e15);

    switch(mode){
      case "name_asc": return byStr(a.name, b.name);
      case "section_asc": return byStr(a.section, b.section);
      case "chromebook_asc": return byNum(a.chromebookNumber, b.chromebookNumber);
      case "seat_asc": return byNum(a.seatNumber, b.seatNumber);
      default: return 0; // already ordered by Firestore query
    }
  }

  function render(){
    if(!tbody || !countLine) return;

    const q = safeLower(searchInput?.value);
    const sortMode = sortSelect?.value || "updated_desc";

    const filtered = records
      .filter(r => matchesSearch(r, q))
      .slice()
      .sort((a,b)=>compare(a,b,sortMode));

    countLine.textContent = `${filtered.length} shown • ${records.length} total`;

    tbody.innerHTML = "";
    if(filtered.length === 0){
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="9" style="padding:14px; color: rgba(234,240,255,.65);">No records found.</td>`;
      tbody.appendChild(tr);
      return;
    }

    for(const r of filtered){
      const tr = document.createElement("tr");
      const tagHex = COLOR_MAP[r.tableColor] || COLOR_MAP.red;

      const shownPw = pwVisible.has(r.id) ? (pwCache.get(r.id) ?? "") : "••••••••";
      const pwClass = pwVisible.has(r.id) ? "" : "pwBlur";
      const eye = pwVisible.has(r.id) ? "🙈" : "👁️";

      const lockNote = isUnlocked() ? "" : `<span style="opacity:.55; font-size:12px;">(locked)</span>`;

      tr.innerHTML = `
        <td><span class="tag" style="background:${tagHex}"></span></td>
        <td>${escapeHtml(r.name)}</td>
        <td>${escapeHtml(r.section)}</td>
        <td>${escapeHtml(r.email || "")}</td>

        <td>
          <div class="pwCell">
            <span class="${pwClass}">${escapeHtml(shownPw)}</span>
            <button class="eyeBtn" data-eye="${r.id}" title="Show/Hide PW">${eye}</button>
            ${lockNote}
          </div>
        </td>

        <td>${r.chromebookNumber ?? ""}</td>
        <td>${r.seatNumber ?? ""}</td>
        <td>${escapeHtml(r.note || "")}</td>

        <td>
          <div class="row-actions">
            <button class="smallbtn edit" data-edit="${r.id}">Edit</button>
            <button class="smallbtn delete" data-del="${r.id}">Delete</button>
          </div>
        </td>
      `;

      tbody.appendChild(tr);
    }
  }

  searchInput?.addEventListener("input", render);
  sortSelect?.addEventListener("change", render);

  tbody.addEventListener("click", (e)=>{
    const eyeBtn = e.target.closest("button[data-eye]");
    const editBtn = e.target.closest("button[data-edit]");
    const delBtn = e.target.closest("button[data-del]");

    if(eyeBtn) return togglePw(eyeBtn.dataset.eye);
    if(editBtn) return startEdit(editBtn.dataset.edit);
    if(delBtn) return deleteStudent(delBtn.dataset.del);
  });

  // Initial
  setUnlocked(false); // lock on load for privacy
  lockBtn.textContent = "🔒 Teacher";
  applyLockUI();
  resetForm();
  render();
});
