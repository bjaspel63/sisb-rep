import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, deleteDoc,
  collection, query, orderBy, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

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

// ========================
// DOM
// ========================
const el = (id) => document.getElementById(id);

const statusPill = el("statusPill");
const teacherPill = el("teacherPill");
const setTeacherPassBtn = el("setTeacherPassBtn");
const lockBtn = el("lockBtn");

const formTitle = el("formTitle");
const studentForm = el("studentForm");

const studentNumberEl = el("studentNumber");
const nameEl = el("name");
const sectionEl = el("section");
const emailEl = el("email");
const pwEl = el("pw");
const pwEyeBtn = el("pwEyeBtn");
const tableColorEl = el("tableColor");
const chromebookNumberEl = el("chromebookNumber");
const noteEl = el("note");

const saveBtn = el("saveBtn");
const cancelBtn = el("cancelBtn");
const deleteBtn = el("deleteBtn");

const rowsEl = el("rows");
const countLine = el("countLine");

const searchEl = el("search");
const refreshBtn = el("refreshBtn");

// CSV
const csvFileEl = el("csvFile");
const importBtn = el("importBtn");
const downloadTemplateBtn = el("downloadTemplateBtn");
const importStatusEl = el("importStatus");

// Print root (used for printing)
const printRootEl = el("printRoot");

// MODAL
const cardModal = el("cardModal");
const cardModalBody = el("cardModalBody");
const closeCardModalBtn = el("closeCardModalBtn");

// ✅ BULK PRINT BUTTONS (add these IDs in your HTML)
const bulkPrintFilteredBtn = el("bulkPrintFilteredBtn");
const bulkPrintAllBtn = el("bulkPrintAllBtn");

// ========================
// STATE
// ========================
let editingId = null;
let liveUnsub = null;
let cache = [];
let selectedForCard = null;

let pwUnlocked = false; // session state only
const TEACHER_HASH_KEY = "teacher_pw_hash_v1";

// ========================
// HELPERS
// ========================
function safeText(v){
  return (v ?? "").toString().replace(/[<>&]/g, c => ({ "<":"&lt;", ">":"&gt;", "&":"&amp;" }[c]));
}

function setStatus(text, online){
  if(!statusPill) return;
  statusPill.textContent = `● ${text}`;
  statusPill.style.color = online ? "var(--good)" : "var(--muted)";
}

function syncPwInputVisibility(){
  if(!pwEl) return;
  if(!pwUnlocked) pwEl.type = "password";
  if(pwEl.type !== "text" && pwEl.type !== "password") pwEl.type = "password";
}

function setTeacherState(unlocked){
  pwUnlocked = !!unlocked;
  if(teacherPill){
    teacherPill.textContent = pwUnlocked ? "👩‍🏫 PW Unlocked" : "🔒 PW Locked";
    teacherPill.style.color = pwUnlocked ? "var(--good)" : "var(--muted)";
  }
  syncPwInputVisibility();
}

function lockNow(){
  setTeacherState(false);
  if(pwEl) pwEl.type = "password";
}

function normalizeColor(color){
  const c = (color || "").toLowerCase().trim();
  return (c === "red" || c === "blue" || c === "yellow") ? c : "red";
}

function colorBadge(color){
  const ok = normalizeColor(color);
  return `
    <span class="badge">
      <span class="dot ${ok}"></span>
      ${ok.toUpperCase()}
    </span>
  `;
}

function maskedPw(pw){
  const s = (pw ?? "").toString();
  if(!s) return `<span class="muted">—</span>`;
  const bullets = "•".repeat(Math.min(10, Math.max(4, s.length)));
  return `<span class="maskText">${bullets}</span>`;
}

function initials(name){
  const s = (name || "").trim();
  if(!s) return "🙂";
  const parts = s.split(/\s+/).slice(0,2);
  return parts.map(p => (p[0] || "").toUpperCase()).join("") || "🙂";
}

function tableLabel(color){
  return normalizeColor(color).toUpperCase();
}

function setMode(mode){
  if(!formTitle) return;

  if(mode === "add"){
    editingId = null;
    formTitle.textContent = "Add Student";
    if(cancelBtn) cancelBtn.hidden = true;
    if(deleteBtn) deleteBtn.hidden = true;
    if(studentNumberEl) studentNumberEl.disabled = false;
    if(saveBtn) saveBtn.textContent = "Save";
  }else{
    formTitle.textContent = "Edit Student";
    if(cancelBtn) cancelBtn.hidden = false;
    if(deleteBtn) deleteBtn.hidden = false;
    if(studentNumberEl) studentNumberEl.disabled = true;
    if(saveBtn) saveBtn.textContent = "Update";
  }

  if(pwEl) pwEl.type = "password";
  syncPwInputVisibility();
}

function resetForm(){
  if(studentForm) studentForm.reset();
  if(chromebookNumberEl) chromebookNumberEl.value = "";
  if(noteEl) noteEl.value = "";
  if(pwEl) pwEl.type = "password";
}

function studentsCol(){ return collection(db, "students"); }
function studentDoc(studentNumber){ return doc(db, "students", studentNumber); }

function normalizeRow(obj){
  return {
    studentNumber: (obj.studentNumber ?? "").toString().trim(),
    name: (obj.name ?? "").toString().trim(),
    section: (obj.section ?? "").toString().trim(),
    email: (obj.email ?? "").toString().trim(),
    pw: (obj.pw ?? "").toString().trim(),
    tableColor: normalizeColor(obj.tableColor),
    chromebookNumber: (obj.chromebookNumber ?? "").toString().trim(),
    note: (obj.note ?? "").toString().trim(),
  };
}

function validateStudent(d){
  if(!d.studentNumber) return "Missing studentNumber";
  if(!d.name) return "Missing name";
  if(!d.section) return "Missing section";
  if(!["red","blue","yellow"].includes(d.tableColor)) return "tableColor must be red/blue/yellow";
  return null;
}

// ========================
// MODAL
// ========================
function modalExists(){
  return !!(cardModal && cardModalBody && closeCardModalBtn);
}

function openModal(){
  if(!cardModal) return;
  cardModal.classList.add("show");
  cardModal.setAttribute("aria-hidden", "false");
}

function closeModal(){
  if(!cardModal) return;
  cardModal.classList.remove("show");
  cardModal.setAttribute("aria-hidden", "true");
}

/* =========================================================
   ✅ ONE HTML FOR BOTH MODAL + PRINT (strip card)
   Matches the CSS: .stripCard.kidStrip + children
   ✅ Fix: email no longer “cut” (separate line + print CSS clamps)
========================================================= */
function renderStripCardHTML(d){
  const ini = initials(d.name);
  const okColor = normalizeColor(d.tableColor);
  const table = tableLabel(okColor);

  const pwDisplay = pwUnlocked ? (d.pw || "—") : "••••••••";
  const pwLock = pwUnlocked ? "" : `<span class="stripLock">(Locked)</span>`;

  const line1 = `# ${safeText(d.studentNumber || "—")} · ${safeText(d.section || "—")}`;
  const email = safeText(d.email || "—");
  const cb = safeText(d.chromebookNumber || "—");
  const note = safeText(d.note || "—");

  return `
    <div class="stripCard kidStrip">
      <div class="stripBar" aria-hidden="true"></div>

      <div class="stripRow">
        <div class="stripAvatar" aria-hidden="true">${safeText(ini)}</div>

        <div class="stripMain">
          <p class="stripName">${safeText(d.name || "—")}</p>
          <p class="stripLine">${line1}</p>
          <p class="stripLine emailLine">Email: ${email}</p>
          <p class="stripLine noteLine">Note: ${note}</p>
        </div>

        <div class="stripMeta">
          <div class="stripPill">
            <span class="dot ${okColor}"></span>
            TABLE ${safeText(table)}
          </div>
          <div class="stripTiny">CB: <b>${cb}</b></div>
          <div class="stripTiny">PW: <b>${safeText(pwDisplay)}</b> ${pwLock}</div>
        </div>
      </div>
    </div>
  `;
}

function renderCardHTML(d){ return renderStripCardHTML(d); }
function renderPrintHTML(d){ return renderStripCardHTML(d); }

function showCard(d){
  selectedForCard = d;
  if(modalExists()){
    cardModalBody.innerHTML = renderCardHTML(d);
    openModal();
  }
}

function refreshSelectedCardUI(){
  if(!selectedForCard) return;

  const updated = cache.find(x => x.studentNumber === selectedForCard.studentNumber) || selectedForCard;
  selectedForCard = updated;

  if(modalExists() && cardModal.classList.contains("show")){
    cardModalBody.innerHTML = renderCardHTML(updated);
  }
}

function printSelectedCard(){
  if(!selectedForCard || !printRootEl) return;
  printRootEl.innerHTML = renderPrintHTML(selectedForCard);
  window.print();
}

// Keep printRoot correct when user uses browser print menu
window.addEventListener("beforeprint", () => {
  // If bulk already rendered, keep it.
  // If modal card selected and printRoot empty, render selected.
  if(selectedForCard && printRootEl && !printRootEl.innerHTML.trim()){
    printRootEl.innerHTML = renderPrintHTML(selectedForCard);
  }
});
window.addEventListener("afterprint", () => {
  if(printRootEl) printRootEl.innerHTML = "";
});

// ========================
// ✅ BULK PRINT (Filtered / All)
// ========================
function getFilteredList(){
  const q = (searchEl?.value || "").trim().toLowerCase();
  if(!q) return cache.slice();

  return cache.filter(d => {
    const hay = [
      d.studentNumber, d.name, d.section, d.email,
      d.tableColor, d.chromebookNumber, d.note, d.pw
    ].join(" ").toLowerCase();
    return hay.includes(q);
  });
}

function printBulk(list){
  if(!printRootEl) return;
  if(!list.length){
    alert("No students to print.");
    return;
  }

  // Sheet wrapper used by your @media print (.printSheet)
  printRootEl.innerHTML = `<div class="printSheet">
    ${list.map(renderPrintHTML).join("")}
  </div>`;

  window.print();
}

// ========================
// TEACHER PASSWORD (LOCAL)
// ========================
async function sha256(text){
  const data = new TextEncoder().encode(text);
  const hashBuf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hashBuf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function setTeacherPasswordFlow(){
  const first = prompt("Set teacher password (used only to unlock PW view on this device):");
  if(first === null) return;
  if(!first.trim()){
    alert("Password cannot be empty.");
    return;
  }
  const second = prompt("Confirm teacher password:");
  if(second === null) return;
  if(second !== first){
    alert("Passwords do not match.");
    return;
  }
  const hash = await sha256(first);
  localStorage.setItem(TEACHER_HASH_KEY, hash);
  setTeacherState(true);

  if(pwEl) pwEl.type = "password";
  syncPwInputVisibility();
  refreshSelectedCardUI();

  alert("Teacher password set. PW view is unlocked for this session.");
}

async function unlockFlow(){
  const stored = localStorage.getItem(TEACHER_HASH_KEY);
  if(!stored){
    const ok = confirm("No teacher password set on this device yet. Set it now?");
    if(ok) await setTeacherPasswordFlow();
    return;
  }
  const attempt = prompt("Enter teacher password to unlock PW view:");
  if(attempt === null) return;
  const h = await sha256(attempt);
  if(h === stored){
    setTeacherState(true);
    if(pwEl) pwEl.type = "password";
    syncPwInputVisibility();
    refreshSelectedCardUI();
  }else{
    alert("Wrong teacher password.");
  }
}

// ========================
// CRUD
// ========================
async function upsertStudent(){
  const raw = normalizeRow({
    studentNumber: studentNumberEl?.value,
    name: nameEl?.value,
    section: sectionEl?.value,
    email: emailEl?.value,
    pw: pwEl?.value,
    tableColor: tableColorEl?.value,
    chromebookNumber: chromebookNumberEl?.value,
    note: noteEl?.value
  });

  const err = validateStudent(raw);
  if(err){
    alert(`Cannot save: ${err}`);
    return;
  }

  const ref = studentDoc(raw.studentNumber);
  const snap = await getDoc(ref);

  const data = { ...raw, updatedAt: serverTimestamp() };
  if(!snap.exists()){
    data.createdAt = serverTimestamp();
  }else{
    const existing = snap.data();
    if(existing?.createdAt) data.createdAt = existing.createdAt;
  }

  await setDoc(ref, data, { merge: true });

  resetForm();
  setMode("add");
}

async function removeStudent(){
  if(!editingId) return;
  const ok = confirm(`Delete student ${editingId}?`);
  if(!ok) return;
  await deleteDoc(studentDoc(editingId));
  resetForm();
  setMode("add");
}

async function loadIntoForm(studentNumber){
  const snap = await getDoc(studentDoc(studentNumber));
  if(!snap.exists()) return;

  const d = normalizeRow(snap.data());
  editingId = studentNumber;

  if(studentNumberEl) studentNumberEl.value = d.studentNumber || studentNumber;
  if(nameEl) nameEl.value = d.name || "";
  if(sectionEl) sectionEl.value = d.section || "";
  if(emailEl) emailEl.value = d.email || "";
  if(pwEl) pwEl.value = d.pw || "";
  if(tableColorEl) tableColorEl.value = d.tableColor || "red";
  if(chromebookNumberEl) chromebookNumberEl.value = d.chromebookNumber || "";
  if(noteEl) noteEl.value = d.note || "";

  setMode("edit");

  if(pwEl) pwEl.type = "password";
  syncPwInputVisibility();
}

// ========================
// RENDER LIST
// ========================
function render(list){
  if(!rowsEl || !countLine) return;

  if(!list.length){
    rowsEl.innerHTML = `<tr><td colspan="9" class="muted">No students yet.</td></tr>`;
    countLine.textContent = "0 students";
    return;
  }

  rowsEl.innerHTML = list.map(d => {
    const sn = safeText(d.studentNumber);

    const pwCell = pwUnlocked
      ? `<span class="pwMask"><span>${safeText(d.pw || "—")}</span>
           <button class="eyeBtn" title="Hide PW" data-eye="hide" type="button">👁️</button>
         </span>`
      : `<span class="pwMask">${maskedPw(d.pw)}
           <button class="eyeBtn" title="Unlock to view PW" data-eye="unlock" type="button">👁️</button>
         </span>`;

    return `
      <tr>
        <td><b>${sn}</b></td>
        <td>${safeText(d.name)}</td>
        <td>${safeText(d.section)}</td>
        <td>${safeText(d.email)}</td>
        <td>${pwCell}</td>
        <td>${colorBadge(d.tableColor)}</td>
        <td>${safeText(d.chromebookNumber)}</td>
        <td>${safeText(d.note)}</td>
        <td style="text-align:right; white-space:nowrap;">
          <button class="btn" data-edit="${sn}" type="button">Edit</button>
          <button class="btn" data-card="${sn}" type="button">Card</button>
        </td>
      </tr>
    `;
  }).join("");

  countLine.textContent = `${list.length} student${list.length === 1 ? "" : "s"}`;
}

function applySearch(){
  const q = (searchEl?.value || "").trim().toLowerCase();
  if(!q){
    render(cache);
    return;
  }

  const filtered = cache.filter(d => {
    const hay = [
      d.studentNumber, d.name, d.section, d.email,
      d.tableColor, d.chromebookNumber, d.note,
      d.pw
    ].join(" ").toLowerCase();
    return hay.includes(q);
  });

  render(filtered);
}

// ========================
// LIVE LISTENER
// ========================
function startLive(){
  if(liveUnsub) liveUnsub();

  const qy = query(studentsCol(), orderBy("studentNumber"));
  liveUnsub = onSnapshot(qy, (snap) => {
    cache = snap.docs.map(s => normalizeRow(s.data()));
    applySearch();
    setStatus("Connected", true);
    refreshSelectedCardUI();
  }, (err) => {
    console.error(err);
    setStatus("Error", false);
    if(rowsEl){
      rowsEl.innerHTML = `<tr><td colspan="9" class="muted">Firestore error. Check config/rules.</td></tr>`;
    }
  });
}

// ========================
// CSV
// ========================
function downloadTextFile(filename, text){
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 800);
}

// Minimal CSV parser (handles quotes)
function parseCSV(csvText){
  const rows = [];
  let i = 0, field = "", row = [], inQuotes = false;

  while(i < csvText.length){
    const c = csvText[i];

    if(inQuotes){
      if(c === '"'){
        if(csvText[i+1] === '"'){ field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }else{
        field += c; i++; continue;
      }
    }else{
      if(c === '"'){ inQuotes = true; i++; continue; }
      if(c === ","){ row.push(field); field = ""; i++; continue; }
      if(c === "\n"){
        row.push(field); field = "";
        if(row.some(v => v.trim() !== "")) rows.push(row);
        row = []; i++; continue;
      }
      if(c === "\r"){ i++; continue; }
      field += c; i++; continue;
    }
  }

  row.push(field);
  if(row.some(v => v.trim() !== "")) rows.push(row);
  return rows;
}

async function importCSVFile(file){
  const text = await file.text();
  const rows = parseCSV(text);
  if(rows.length < 2) throw new Error("CSV has no data rows.");

  const header = rows[0].map(h => h.trim());
  const needed = ["studentNumber","name","section","email","pw","tableColor","chromebookNumber","note"];

  const idx = {};
  header.forEach((h, i) => idx[h] = i);

  const mustHave = ["studentNumber","name","section","tableColor"];
  for(const k of mustHave){
    if(idx[k] === undefined) throw new Error(`Missing column: ${k}`);
  }

  let okCount = 0;
  const errors = [];

  for(let r = 1; r < rows.length; r++){
    const cols = rows[r];
    const obj = {};
    for(const k of needed){
      if(idx[k] !== undefined){
        obj[k] = (cols[idx[k]] ?? "").toString();
      }
    }

    const d = normalizeRow(obj);
    const err = validateStudent(d);
    if(err){
      errors.push(`Row ${r+1}: ${err}`);
      continue;
    }

    try{
      const ref = studentDoc(d.studentNumber);
      const snap = await getDoc(ref);

      const data = { ...d, updatedAt: serverTimestamp() };
      if(!snap.exists()){
        data.createdAt = serverTimestamp();
      }else{
        const existing = snap.data();
        if(existing?.createdAt) data.createdAt = existing.createdAt;
      }

      await setDoc(ref, data, { merge: true });
      okCount++;
    }catch(e){
      errors.push(`Row ${r+1}: Firestore write failed`);
    }
  }

  return { okCount, errors };
}

// ========================
// EVENTS
// ========================
if(studentForm){
  studentForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if(saveBtn) saveBtn.disabled = true;
    try{
      await upsertStudent();
    }catch(err){
      console.error(err);
      alert("Save failed. Check Firebase config and Firestore rules.");
    }finally{
      if(saveBtn) saveBtn.disabled = false;
    }
  });
}

if(cancelBtn){
  cancelBtn.addEventListener("click", () => {
    resetForm();
    setMode("add");
  });
}

if(deleteBtn){
  deleteBtn.addEventListener("click", async () => {
    deleteBtn.disabled = true;
    try{
      await removeStudent();
    }catch(err){
      console.error(err);
      alert("Delete failed. Check rules.");
    }finally{
      deleteBtn.disabled = false;
    }
  });
}

// Table interactions
if(rowsEl){
  rowsEl.addEventListener("click", async (e) => {
    const editBtn = e.target.closest("button[data-edit]");
    if(editBtn){
      const id = editBtn.getAttribute("data-edit");
      loadIntoForm(id);
      return;
    }

    const cardBtn = e.target.closest("button[data-card]");
    if(cardBtn){
      const id = cardBtn.getAttribute("data-card");
      const d = cache.find(x => x.studentNumber === id);
      if(d) showCard(d);
      return;
    }

    const eyeBtn = e.target.closest("button[data-eye]");
    if(eyeBtn){
      const action = eyeBtn.getAttribute("data-eye");
      if(action === "unlock"){
        await unlockFlow();
      }else{
        lockNow();
      }
      applySearch();
      refreshSelectedCardUI();
      if(pwEl) pwEl.type = "password";
      syncPwInputVisibility();
    }
  });
}

if(searchEl) searchEl.addEventListener("input", applySearch);
if(refreshBtn) refreshBtn.addEventListener("click", startLive);

if(setTeacherPassBtn) setTeacherPassBtn.addEventListener("click", setTeacherPasswordFlow);

if(lockBtn){
  lockBtn.addEventListener("click", () => {
    lockNow();
    applySearch();
    refreshSelectedCardUI();
  });
}

// 👁️ button inside the form input
if(pwEyeBtn){
  pwEyeBtn.addEventListener("click", async () => {
    if(!pwUnlocked){
      await unlockFlow();
      if(pwEl) pwEl.type = "password";
      syncPwInputVisibility();
      refreshSelectedCardUI();
      return;
    }
    if(!pwEl) return;
    pwEl.type = (pwEl.type === "password") ? "text" : "password";
  });
}

// ✅ Bulk print buttons
if(bulkPrintFilteredBtn){
  bulkPrintFilteredBtn.addEventListener("click", () => {
    const list = getFilteredList();
    printBulk(list);
  });
}
if(bulkPrintAllBtn){
  bulkPrintAllBtn.addEventListener("click", () => {
    printBulk(cache.slice());
  });
}

// Modal close
if(closeCardModalBtn) closeCardModalBtn.addEventListener("click", () => closeModal());

if(cardModal){
  cardModal.addEventListener("click", (e) => {
    if(e.target === cardModal) closeModal();
  });
}

// ESC closes modal + Ctrl/Cmd+P prints card when modal open
window.addEventListener("keydown", (e) => {
  if(e.key === "Escape") closeModal();

  if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p"){
    if(cardModal?.classList.contains("show") && selectedForCard){
      e.preventDefault();
      printSelectedCard();
    }
  }
});

window.addEventListener("online", () => setStatus("Online", true));
window.addEventListener("offline", () => setStatus("Offline", false));

// CSV template
if(downloadTemplateBtn){
  downloadTemplateBtn.addEventListener("click", () => {
    const template =
`studentNumber,name,section,email,pw,tableColor,chromebookNumber,note
20260012,Alex Santos,P3-Ruby,alex@email.com,SamplePW,red,14,Needs charger
20260013,Mia Cruz,P3-Ruby,mia@email.com,,blue,7,
`;
    downloadTextFile("students_template.csv", template);
  });
}

if(importBtn){
  importBtn.addEventListener("click", async () => {
    const file = csvFileEl?.files?.[0];
    if(!file){
      alert("Choose a CSV file first.");
      return;
    }

    importBtn.disabled = true;
    if(importStatusEl) importStatusEl.textContent = "Importing…";

    try{
      const res = await importCSVFile(file);
      if(importStatusEl) importStatusEl.textContent = `Imported: ${res.okCount}. Errors: ${res.errors.length}`;
      if(res.errors.length){
        alert("Some rows failed:\n\n" + res.errors.slice(0, 20).join("\n") + (res.errors.length > 20 ? "\n…more" : ""));
      }
    }catch(err){
      console.error(err);
      alert(err.message || "CSV import failed.");
      if(importStatusEl) importStatusEl.textContent = "Import failed.";
    }finally{
      importBtn.disabled = false;
    }
  });
}

// ========================
// START
// ========================
setMode("add");
setStatus(navigator.onLine ? "Online" : "Offline", navigator.onLine);
setTeacherState(false);

if(modalExists()){
  cardModalBody.innerHTML = `<div class="muted">Select a student (click “Card”).</div>`;
}

startLive();


