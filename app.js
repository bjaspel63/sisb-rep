import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, deleteDoc,
  collection, query, orderBy, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// ========================
// FIREBASE
// ========================
const firebaseConfig = {
  apiKey: "AIzaSyAF50UAawqFWXREMtbk7DcE8BCPAZgA_i0",
  authDomain: "sisb-rep.firebaseapp.com",
  projectId: "sisb-rep",
  storageBucket: "sisb-rep.firebasestorage.app",
  messagingSenderId: "435697746373",
  appId: "1:435697746373:web:43fe4a995de3b77a8b0bac"
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
const seatNumberEl = el("seatNumber");
const noteEl = el("note");

const saveBtn = el("saveBtn");
const cancelBtn = el("cancelBtn");
const deleteBtn = el("deleteBtn");

const rowsEl = el("rows");
const countLine = el("countLine");

const searchEl = el("search");
const refreshBtn = el("refreshBtn");

const csvFileEl = el("csvFile");
const importBtn = el("importBtn");
const downloadTemplateBtn = el("downloadTemplateBtn");
const importStatusEl = el("importStatus");

const printRootEl = el("printRoot");

const cardModal = el("cardModal");
const cardModalBody = el("cardModalBody");
const closeCardModalBtn = el("closeCardModalBtn");

const bulkPrintFilteredBtn = el("bulkPrintFilteredBtn");
const bulkPrintAllBtn = el("bulkPrintAllBtn");

// 🔥 CARD VIEW
const cardViewBtn = el("cardViewBtn");
const cardGrid = el("cardGrid");
const tableWrap = document.querySelector(".tableWrap");

// ========================
// STATE
// ========================
let editingId = null;
let liveUnsub = null;
let cache = [];
let selectedForCard = null;

let pwUnlocked = false;
let isCardView = false;

const TEACHER_HASH_KEY = "teacher_pw_hash_v1";

// ========================
// HELPERS
// ========================
function safeText(v){
  return (v ?? "").toString().replace(/[<>&]/g, c => ({
    "<":"&lt;", ">":"&gt;", "&":"&amp;"
  }[c]));
}

function normalizeColor(color){
  const c = (color || "").toLowerCase().trim();
  return ["red","blue","yellow"].includes(c) ? c : "red";
}

// ========================
// CARD GRID VIEW
// ========================
function renderCardGrid(list){
  if(!cardGrid) return;

  if(!list.length){
    cardGrid.innerHTML = `<div class="muted">No students.</div>`;
    countLine.textContent = "0 students";
    return;
  }

  cardGrid.innerHTML = list.map(d => {
    const color = normalizeColor(d.tableColor);

    return `
      <div class="studentCard" data-card="${d.studentNumber}">
        <div class="colorBar color-${color}"></div>
        <div class="studentName">${safeText(d.name)}</div>
        <div class="studentNumber"># ${safeText(d.studentNumber)}</div>
        <div class="studentMeta">${safeText(d.section)}</div>
        <div class="studentMeta">Seat: ${safeText(d.seatNumber || "—")}</div>
        <div class="studentMeta">${color.toUpperCase()}</div>
      </div>
    `;
  }).join("");

  countLine.textContent = `${list.length} student${list.length === 1 ? "" : "s"}`;
}

// ========================
// TABLE RENDER
// ========================
function render(list){
  if(!rowsEl) return;

  if(!list.length){
    rowsEl.innerHTML = `<tr><td colspan="9">No students</td></tr>`;
    countLine.textContent = "0 students";
    return;
  }

  rowsEl.innerHTML = list.map(d => `
    <tr>
      <td><b>${safeText(d.studentNumber)}</b></td>
      <td>${safeText(d.name)}</td>
      <td>${safeText(d.section)}</td>
      <td>${safeText(d.email)}</td>
      <td>${safeText(d.pw || "—")}</td>
      <td>${safeText(d.tableColor)}</td>
      <td>${safeText(d.seatNumber)}</td>
      <td>${safeText(d.note)}</td>
      <td><button data-card="${d.studentNumber}">Card</button></td>
    </tr>
  `).join("");

  countLine.textContent = `${list.length} students`;
}

// ========================
// SEARCH
// ========================
function applySearch(){
  const q = (searchEl?.value || "").toLowerCase();

  const filtered = cache.filter(d =>
    Object.values(d).join(" ").toLowerCase().includes(q)
  );

  if(isCardView){
    renderCardGrid(filtered);
  } else {
    render(filtered);
  }
}

// ========================
// TOGGLE VIEW
// ========================
function toggleCardView(){
  isCardView = !isCardView;

  if(isCardView){
    tableWrap.style.display = "none";
    cardGrid.hidden = false;
    renderCardGrid(cache);
    cardViewBtn.textContent = "Table View";
  }else{
    tableWrap.style.display = "block";
    cardGrid.hidden = true;
    render(cache);
    cardViewBtn.textContent = "Card View";
  }
}

// ========================
// MODAL
// ========================
function showCard(d){
  selectedForCard = d;
  cardModalBody.innerHTML = `
    <h2>${safeText(d.name)}</h2>
    <p># ${safeText(d.studentNumber)}</p>
    <p>${safeText(d.section)}</p>
    <p>Seat: ${safeText(d.seatNumber)}</p>
    <p>Table: ${safeText(d.tableColor)}</p>
  `;
  cardModal.classList.add("show");
}

function closeModal(){
  cardModal.classList.remove("show");
}

// ========================
// FIRESTORE LIVE
// ========================
function startLive(){
  const qy = query(collection(db, "students"), orderBy("studentNumber"));

  liveUnsub = onSnapshot(qy, (snap) => {
    cache = snap.docs.map(s => s.data());
    applySearch();
  });
}

// ========================
// EVENTS
// ========================
if(cardViewBtn){
  cardViewBtn.addEventListener("click", toggleCardView);
}

if(searchEl){
  searchEl.addEventListener("input", applySearch);
}

if(rowsEl){
  rowsEl.addEventListener("click", (e) => {
    const id = e.target.getAttribute("data-card");
    if(!id) return;

    const d = cache.find(x => x.studentNumber === id);
    if(d) showCard(d);
  });
}

if(cardGrid){
  cardGrid.addEventListener("click", (e) => {
    const card = e.target.closest("[data-card]");
    if(!card) return;

    const id = card.getAttribute("data-card");
    const d = cache.find(x => x.studentNumber === id);
    if(d) showCard(d);
  });
}

if(closeCardModalBtn){
  closeCardModalBtn.addEventListener("click", closeModal);
}

if(bulkPrintFilteredBtn){
  bulkPrintFilteredBtn.addEventListener("click", () => window.print());
}

if(bulkPrintAllBtn){
  bulkPrintAllBtn.addEventListener("click", () => window.print());
}

// ========================
// START
// ========================
startLive();
