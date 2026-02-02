// Student Database (Firestore) - Vanilla JS
// Stores: studentNumber, name, section, email, pw (plain field), tableColor, chromebookNumber, note

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

// ========================
// STATE
// ========================
let editingId = null; // studentNumber being edited
let liveUnsub = null;
let cache = []; // local cache for search filtering

// ========================
// HELPERS
// ========================
function safeText(v){
  return (v ?? "").toString().replace(/[<>&]/g, c => ({ "<":"&lt;", ">":"&gt;", "&":"&amp;" }[c]));
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

function setMode(mode){
  // mode: "add" | "edit"
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
    studentNumberEl.disabled = true; // keep ID stable
    saveBtn.textContent = "Update";
  }
}

function resetForm(){
  studentForm.reset();
  chromebookNumberEl.value = "";
  noteEl.value = "";
}

function setStatus(text, online){
  statusPill.textContent = `● ${text}`;
  statusPill.style.color = online ? "var(--good)" : "var(--muted)";
}

// ========================
// FIRESTORE CRUD
// ========================
function studentsCol(){
  return collection(db, "students");
}

function studentDoc(studentNumber){
  return doc(db, "students", studentNumber);
}

async function upsertStudent(){
  const studentNumber = studentNumberEl.value.trim();
  const name = nameEl.value.trim();
  const section = sectionEl.value.trim();

  if(!studentNumber || !name || !section){
    alert("Please fill: Student Number, Name, Section.");
    return;
  }

  const tableColor = tableColorEl.value.trim().toLowerCase();
  if(!["red","blue","yellow"].includes(tableColor)){
    alert("Table Color must be red, blue, or yellow.");
    return;
  }

  const data = {
    studentNumber,
    name,
    section,
    email: emailEl.value.trim(),
    pw: pwEl.value.trim(), // ✅ PW stored as normal field
    tableColor,
    chromebookNumber: chromebookNumberEl.value.trim(),
    note: noteEl.value.trim(),
    updatedAt: serverTimestamp()
  };

  // For new docs, also add createdAt if missing
  const ref = studentDoc(studentNumber);
  const snap = await getDoc(ref);
  if(!snap.exists()){
    data.createdAt = serverTimestamp();
  }else{
    // keep original createdAt if it exists
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

  const d = snap.data();
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
// RENDER
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
    return `
      <tr>
        <td><b>${sn}</b></td>
        <td>${safeText(d.name)}</td>
        <td>${safeText(d.section)}</td>
        <td>${safeText(d.email)}</td>
        <td>${safeText(d.pw)}</td>
        <td>${colorBadge(d.tableColor)}</td>
        <td>${cb}</td>
        <td>${safeText(d.note)}</td>
        <td style="text-align:right;">
          <button class="btn" data-edit="${sn}">Edit</button>
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
      d.studentNumber, d.name, d.section, d.email, d.pw,
      d.tableColor, d.chromebookNumber, d.note
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

  const q = query(studentsCol(), orderBy("studentNumber"));
  liveUnsub = onSnapshot(q, (snap) => {
    cache = snap.docs.map(docu => docu.data());
    applySearch();
    setStatus("Connected", true);
  }, (err) => {
    console.error(err);
    setStatus("Error", false);
    rowsEl.innerHTML = `<tr><td colspan="9" class="muted">Firestore error. Check config/rules.</td></tr>`;
  });
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

rowsEl.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-edit]");
  if(!btn) return;
  const id = btn.getAttribute("data-edit");
  loadIntoForm(id);
});

searchEl.addEventListener("input", applySearch);
refreshBtn.addEventListener("click", startLive);

window.addEventListener("online", () => setStatus("Online", true));
window.addEventListener("offline", () => setStatus("Offline", false));

// ========================
// START
// ========================
setMode("add");
setStatus(navigator.onLine ? "Online" : "Offline", navigator.onLine);
startLive();
