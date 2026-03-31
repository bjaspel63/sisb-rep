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

const rowsEl = el("rows");
const countLine = el("countLine");
const searchEl = el("search");

const cardViewBtn = el("cardViewBtn");
const cardGrid = el("cardGrid");
const tableWrap = document.querySelector(".tableWrap");

const cardModal = el("cardModal");
const cardModalBody = el("cardModalBody");
const closeCardModalBtn = el("closeCardModalBtn");

const bulkPrintFilteredBtn = el("bulkPrintFilteredBtn");
const bulkPrintAllBtn = el("bulkPrintAllBtn");

const printRootEl = el("printRoot");

// ========================
// STATE
// ========================
let cache = [];
let selectedForCard = null;
let isCardView = false;

// ========================
// HELPERS
// ========================
function safeText(v){
  return (v ?? "").toString().replace(/[<>&]/g, c => ({
    "<":"&lt;", ">":"&gt;", "&":"&amp;"
  }[c]));
}

function normalizeColor(c){
  c = (c || "").toLowerCase();
  return ["red","blue","yellow"].includes(c) ? c : "red";
}

// ========================
// TABLE RENDER
// ========================
function render(list){
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
      <td>
        <button data-card="${d.studentNumber}">Card</button>
      </td>
    </tr>
  `).join("");

  countLine.textContent = `${list.length} students`;
}

// ========================
// 🔥 CARD GRID VIEW
// ========================
function renderCardGrid(list){
  if(!cardGrid) return;

  if(!list.length){
    cardGrid.innerHTML = `<div>No students</div>`;
    countLine.textContent = "0 students";
    return;
  }

  cardGrid.innerHTML = list.map(d => {
    const color = normalizeColor(d.tableColor);

    return `
      <div class="studentCard" data-card="${d.studentNumber}">
        <div class="colorBar color-${color}"></div>
        <div><b>${safeText(d.name)}</b></div>
        <div># ${safeText(d.studentNumber)}</div>
        <div>${safeText(d.section)}</div>
        <div>Seat: ${safeText(d.seatNumber || "-")}</div>
        <div>${color.toUpperCase()}</div>
      </div>
    `;
  }).join("");

  countLine.textContent = `${list.length} students`;
}

// ========================
// SEARCH
// ========================
function applySearch(){
  const q = (searchEl.value || "").toLowerCase();

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
// PRINT
// ========================
function printBulk(list){
  printRootEl.innerHTML = list.map(d => `
    <div>${safeText(d.name)} (${safeText(d.studentNumber)})</div>
  `).join("");

  window.print();
}

// ========================
// FIRESTORE LIVE
// ========================
function startLive(){
  const qy = query(collection(db, "students"), orderBy("studentNumber"));

  onSnapshot(qy, snap => {
    cache = snap.docs.map(d => d.data());
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
  rowsEl.addEventListener("click", e => {
    const id = e.target.getAttribute("data-card");
    if(!id) return;

    const d = cache.find(x => x.studentNumber === id);
    if(d) showCard(d);
  });
}

if(cardGrid){
  cardGrid.addEventListener("click", e => {
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
  bulkPrintFilteredBtn.addEventListener("click", () => printBulk(cache));
}

if(bulkPrintAllBtn){
  bulkPrintAllBtn.addEventListener("click", () => printBulk(cache));
}

// ========================
// START
// ========================
startLive();
