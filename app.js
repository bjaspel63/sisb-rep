// Student Database (Firestore) - Vanilla JS
// Adds: PW blur + teacher unlock + CSV import + card printing

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

// Card/Print
const studentCardEl = el("studentCard");
const printRootEl = el("printRoot");
const printCardBtn = el("printCardBtn");
const clearCardBtn = el("clearCardBtn");

// ========================
// STATE
// ========================
let editingId = null;
let liveUnsub = null;
let cache = [];
let selectedForCard = null;

// teacher unlock state (session)
let pwUnlocked = false;

// Local teacher password hash storage (browser only)
const TEACHER_HASH_KEY = "teacher_pw_hash_v1";

// ========================
// HELPERS
// ========================
function safeText(v){
  return (v ?? "").toString().replace(/[<>&]/g, c => ({ "<":"&lt;", ">":"&gt;", "&":"&amp;" }[c]));
}

function setStatus(text, online){
  statusPill.textContent = `● ${text}`;
  statusPill.style.color = online ? "var(--good)" : "var(--muted)";
}

function setTeacherState(unlocked){
  pwUnlocked = !!unlocked;
  teacherPill.textContent = pwUnlocked ? "👩‍🏫 PW Unlocked" : "🔒 PW Locked";
  teacherPill.style.color = pwUnlocked ? "var(--good)" : "var(--muted)";
}

function colorBadge(color){
  const c = (color || "").toLowerCase();
  const ok = (c === "red" || c === "blue" || c === "yellow") ? c : "red";
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

function setMode(mode){
  if(mode === "add"){
    editingId = null;
    formTitle.textContent = "Add Student";
    cancelBtn.hidden = true;
    deleteBtn.hidden = true;
    studentNumberEl.disabled = false;
    saveBtn.textContent = "Save";
  }else{
    formTitle.textContent = "Edit Student";
    cancelBtn.hidden = false;
    deleteBtn.hidden = false;
    studentNumberEl.disabled = true;
    saveBtn.textContent = "Update";
  }
}

function resetForm(){
  studentForm.reset();
  chromebookNumberEl.value = "";
  noteEl.value = "";
}

function studentsCol(){ return collection(db, "students"); }
function studentDoc(studentNumber){ return doc(db, "students", studentNumber); }

function normalizeRow(obj){
  // ensures consistent shape
  return {
    studentNumber: (obj.studentNumber ?? "").toString().trim(),
    name: (obj.name ?? "").toString().trim(),
    section: (obj.section ?? "").toString().trim(),
    email: (obj.email ?? "").toString().trim(),
    pw: (obj.pw ?? "").toString().trim(),
    tableColor: (obj.tableColor ?? "").toString().trim().toLowerCase(),
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
  }else{
    alert("Wrong teacher password.");
  }
}

function lockNow(){
  setTeacherState(false);
}

// ========================
// CRUD
// ========================
async function upsertStudent(){
  const raw = normalizeRow({
    studentNumber: studentNumberEl.value,
    name: nameEl.value,
    section: sectionEl.value,
    email: emailEl.value,
    pw: pwEl.value,
    tableColor: tableColorEl.value,
    chromebookNumber: chromebookNumberEl.value,
    note: noteEl.value
  });

  const err = validateStudent(raw);
  if(err){
    alert(`Cannot save: ${err}`);
    return;
  }

  const ref = studentDoc(raw.studentNumber);
  const snap = await getDoc(ref);

  const data = {
    ...raw,
    updatedAt: serverTimestamp()
  };

  if(!snap.exists()){
    data.createdAt = serverTimestamp();
  }else{
    const existing = snap.data();
    if(existing?.createdAt) data.createdAt = existing.createdAt;
  }

  await setDoc(ref, data, { merge: true });

  if(!editingId){
    resetForm();
  }
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

  studentNumberEl.value = d.studentNumber || studentNumber;
  nameEl.value = d.name || "";
  sectionEl.value = d.section || "";
  emailEl.value = d.email || "";
  pwEl.value = d.pw || "";
  tableColorEl.value = d.tableColor || "";
  chromebookNumberEl.value = d.chromebookNumber || "";
  noteEl.value = d.note || "";

  setMode("edit");
}

// ========================
// CARD + PRINT
// ========================
function renderCard(d){
  if(!d){
    selectedForCard = null;
    studentCardEl.classList.add("empty");
    studentCardEl.innerHTML = `<div class="muted">Select a student (click “Card”).</div>`;
    printCardBtn.disabled = true;
    clearCardBtn.disabled = true;
    return;
  }
  selectedForCard = d;
  studentCardEl.classList.remove("empty");

  const pwDisplay = pwUnlocked ? safeText(d.pw || "—") : "••••••••";
  const pwNote = pwUnlocked ? "" : `<span class="muted small">(Locked)</span>`;

  studentCardEl.innerHTML = `
    <div class="cardTop">
      <div>
        <div class="cardTitle">${safeText(d.name)}</div>
        <div class="muted small">Student # <b>${safeText(d.studentNumber)}</b> · Section <b>${safeText(d.section)}</b></div>
      </div>
      <div class="cardTag">${colorBadge(d.tableColor)}</div>
    </div>

    <div class="cardMeta">
      <div><b>Email</b>${safeText(d.email || "—")}</div>
      <div><b>Chromebook #</b>${safeText(d.chromebookNumber || "—")}</div>
      <div><b>PW</b>${pwDisplay} ${pwNote}</div>
      <div><b>Note</b>${safeText(d.note || "—")}</div>
    </div>
  `;

  printCardBtn.disabled = false;
  clearCardBtn.disabled = false;
}

function printSelectedCard(){
  if(!selectedForCard) return;

  const d = selectedForCard;
  const pwDisplay = pwUnlocked ? (d.pw || "—") : "••••••••";

  printRootEl.innerHTML = `
    <div class="printCard">
      <div class="title">Student Card</div>
      <div class="printGrid">
        <div>
          <div class="k">Student #</div>
          <div class="v">${safeText(d.studentNumber)}</div>
        </div>
        <div>
          <div class="k">Name</div>
          <div class="v">${safeText(d.name)}</div>
        </div>
        <div>
          <div class="k">Section</div>
          <div class="v">${safeText(d.section)}</div>
        </div>
        <div>
          <div class="k">Table</div>
          <div class="v">${safeText((d.tableColor||"").toUpperCase())}</div>
        </div>
        <div>
          <div class="k">Email</div>
          <div class="v">${safeText(d.email || "—")}</div>
        </div>
        <div>
          <div class="k">Chromebook #</div>
          <div class="v">${safeText(d.chromebookNumber || "—")}</div>
        </div>
        <div>
          <div class="k">PW</div>
          <div class="v">${safeText(pwDisplay)}</div>
        </div>
        <div>
          <div class="k">Note</div>
          <div class="v">${safeText(d.note || "—")}</div>
        </div>
      </div>
    </div>
  `;

  window.print();
  printRootEl.innerHTML = "";
}

// ========================
// RENDER LIST
// ========================
function render(list){
  if(!list.length){
    rowsEl.innerHTML = `<tr><td colspan="9" class="muted">No students yet.</td></tr>`;
    countLine.textContent = "0 students";
    return;
  }

  rowsEl.innerHTML = list.map(d => {
    const sn = safeText(d.studentNumber);
    const cb = safeText(d.chromebookNumber);

    const pwCell = pwUnlocked
      ? `<span class="pwMask"><span>${safeText(d.pw || "—")}</span>
           <button class="eyeBtn" title="Hide PW" data-eye="hide">👁️</button>
         </span>`
      : `<span class="pwMask">${maskedPw(d.pw)}
           <button class="eyeBtn" title="Unlock to view PW" data-eye="unlock">👁️</button>
         </span>`;

    return `
      <tr>
        <td><b>${sn}</b></td>
        <td>${safeText(d.name)}</td>
        <td>${safeText(d.section)}</td>
        <td>${safeText(d.email)}</td>
        <td>${pwCell}</td>
        <td>${colorBadge(d.tableColor)}</td>
        <td>${cb}</td>
        <td>${safeText(d.note)}</td>
        <td style="text-align:right;">
          <button class="btn" data-edit="${sn}">Edit</button>
          <button class="btn" data-card="${sn}">Card</button>
        </td>
      </tr>
    `;
  }).join("");

  countLine.textContent = `${list.length} student${list.length === 1 ? "" : "s"}`;
}

function applySearch(){
  const q = (searchEl.value || "").trim().toLowerCase();
  if(!q){
    render(cache);
    return;
  }
  const filtered = cache.filter(d => {
    const hay = [
      d.studentNumber, d.name, d.section, d.email,
      d.tableColor, d.chromebookNumber, d.note,
      // include pw in search even if locked (teacher only usually)
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

    // keep card updated if selected
    if(selectedForCard){
      const updated = cache.find(x => x.studentNumber === selectedForCard.studentNumber);
      if(updated) renderCard(updated);
    }
  }, (err) => {
    console.error(err);
    setStatus("Error", false);
    rowsEl.innerHTML = `<tr><td colspan="9" class="muted">Firestore error. Check config/rules.</td></tr>`;
  });
}

// ========================
// CSV IMPORT
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
        // ignore completely empty trailing row
        if(row.some(v => v.trim() !== "")) rows.push(row);
        row = []; i++; continue;
      }
      if(c === "\r"){ i++; continue; }
      field += c; i++; continue;
    }
  }
  // last field
  row.push(field);
  if(row.some(v => v.trim() !== "")) rows.push(row);

  return rows;
}

async function importCSVFile(file){
  const text = await file.text();
  const rows = parseCSV(text);
  if(rows.length < 2){
    throw new Error("CSV has no data rows.");
  }

  const header = rows[0].map(h => h.trim());
  const needed = ["studentNumber","name","section","email","pw","tableColor","chromebookNumber","note"];

  // Build header map
  const idx = {};
  header.forEach((h, i) => idx[h] = i);

  // Must include required columns at least studentNumber,name,section,tableColor
  const mustHave = ["studentNumber","name","section","tableColor"];
  for(const k of mustHave){
    if(idx[k] === undefined){
      throw new Error(`Missing column: ${k}`);
    }
  }

  let okCount = 0;
  const errors = [];

  // Import sequentially (safe + simple)
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

      const data = {
        ...d,
        updatedAt: serverTimestamp()
      };
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
studentForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  saveBtn.disabled = true;
  try{
    await upsertStudent();
  }catch(err){
    console.error(err);
    alert("Save failed. Check Firebase config and Firestore rules.");
  }finally{
    saveBtn.disabled = false;
  }
});

cancelBtn.addEventListener("click", () => {
  resetForm();
  setMode("add");
});

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
    if(d) renderCard(d);
    return;
  }

  const eyeBtn = e.target.closest("button[data-eye]");
  if(eyeBtn){
    const action = eyeBtn.getAttribute("data-eye");
    if(action === "unlock"){
      await unlockFlow();
      // rerender to show PW if unlocked
      applySearch();
      // refresh card state too
      if(selectedForCard){
        const updated = cache.find(x => x.studentNumber === selectedForCard.studentNumber);
        if(updated) renderCard(updated);
      }
    }else{
      // hide
      lockNow();
      applySearch();
      if(selectedForCard){
        const updated = cache.find(x => x.studentNumber === selectedForCard.studentNumber);
        if(updated) renderCard(updated);
      }
    }
  }
});

searchEl.addEventListener("input", applySearch);
refreshBtn.addEventListener("click", startLive);

// Teacher password buttons
setTeacherPassBtn.addEventListener("click", setTeacherPasswordFlow);
lockBtn.addEventListener("click", () => {
  lockNow();
  applySearch();
  if(selectedForCard){
    const updated = cache.find(x => x.studentNumber === selectedForCard.studentNumber);
    if(updated) renderCard(updated);
  }
});

// CSV buttons
downloadTemplateBtn.addEventListener("click", () => {
  const template =
`studentNumber,name,section,email,pw,tableColor,chromebookNumber,note
20260012,Alex Santos,P3-Ruby,alex@email.com,SamplePW,red,14,Needs charger
20260013,Mia Cruz,P3-Ruby,mia@email.com,,blue,7,
`;
  downloadTextFile("students_template.csv", template);
});

importBtn.addEventListener("click", async () => {
  const file = csvFileEl.files?.[0];
  if(!file){
    alert("Choose a CSV file first.");
    return;
  }

  importBtn.disabled = true;
  importStatusEl.textContent = "Importing…";
  try{
    const res = await importCSVFile(file);
    importStatusEl.textContent = `Imported: ${res.okCount}. Errors: ${res.errors.length}`;
    if(res.errors.length){
      alert("Some rows failed:\n\n" + res.errors.slice(0, 20).join("\n") + (res.errors.length > 20 ? "\n…more" : ""));
    }
  }catch(err){
    console.error(err);
    alert(err.message || "CSV import failed.");
    importStatusEl.textContent = "Import failed.";
  }finally{
    importBtn.disabled = false;
  }
});

// Print
printCardBtn.addEventListener("click", printSelectedCard);
clearCardBtn.addEventListener("click", () => renderCard(null));

window.addEventListener("online", () => setStatus("Online", true));
window.addEventListener("offline", () => setStatus("Offline", false));

// ========================
// START
// ========================
setMode("add");
setStatus(navigator.onLine ? "Online" : "Offline", navigator.onLine);
setTeacherState(false);
renderCard(null);
startLive();
