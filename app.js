import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore, collection, doc, setDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

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
const auth = getAuth(app);

const $ = (id) => document.getElementById(id);

// UI refs
const authBadge = $("authBadge");
const loginBtn = $("loginBtn");
const logoutBtn = $("logoutBtn");

const loginModal = $("loginModal");
const closeLoginModal = $("closeLoginModal");
const cancelLoginBtn = $("cancelLoginBtn");
const doLoginBtn = $("doLoginBtn");
const teacherEmail = $("teacherEmail");
const teacherPass = $("teacherPass");

const studentForm = $("studentForm");
const formTitle = $("formTitle");
const saveBtn = $("saveBtn");
const cancelEditBtn = $("cancelEditBtn");

const nameEl = $("name");
const sectionEl = $("section");
const emailEl = $("email");
const pwEl = $("pw");
const noteEl = $("note");
const chromebookEl = $("chromebook");
const seatEl = $("seat");
const tableColorEl = $("tableColor");
const colorSwatch = $("colorSwatch");

const tbody = $("tbody");
const searchInput = $("searchInput");
const sortSelect = $("sortSelect");
const countLine = $("countLine");

// Data + state
let records = [];            // students collection
let editingId = null;
let currentUser = null;

// PW visibility cache
const pwCache = new Map();   // id -> pw string
const pwVisible = new Set(); // ids currently revealed

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
function canEdit(){
  return !!currentUser; // based on Auth + rules
}

function setColorUI(colorKey){
  const hex = COLOR_MAP[colorKey] || COLOR_MAP.red;
  colorSwatch.style.background = hex;
}

tableColorEl.addEventListener("change", ()=> setColorUI(tableColorEl.value));
setColorUI(tableColorEl.value);

// ---------- Auth ----------
function openLogin(){
  loginModal.hidden = false;
  teacherEmail.value = "";
  teacherPass.value = "";
  teacherEmail.focus();
}
function closeLogin(){
  loginModal.hidden = true;
}

loginBtn.addEventListener("click", openLogin);
closeLoginModal.addEventListener("click", closeLogin);
cancelLoginBtn.addEventListener("click", closeLogin);

doLoginBtn.addEventListener("click", async ()=>{
  const em = norm(teacherEmail.value);
  const pw = norm(teacherPass.value);
  if(!em || !pw) return alert("Enter email + password.");
  try{
    await signInWithEmailAndPassword(auth, em, pw);
    closeLogin();
  }catch(e){
    alert("Login failed: " + (e?.message || "Unknown error"));
  }
});

logoutBtn.addEventListener("click", async ()=>{
  await signOut(auth);
});

// update UI when auth changes
onAuthStateChanged(auth, (user)=>{
  currentUser = user || null;
  if(user){
    authBadge.textContent = `👤 ${user.email}`;
    loginBtn.hidden = true;
    logoutBtn.hidden = false;
  }else{
    authBadge.textContent = "👤 Not logged in";
    loginBtn.hidden = false;
    logoutBtn.hidden = true;

    // hide all revealed PW immediately when teacher logs out
    pwVisible.clear();
  }
  render();
});

// ---------- Firestore subscription ----------
const studentsRef = collection(db, "students");
const qStudents = query(studentsRef, orderBy("updatedAt", "desc"));

onSnapshot(qStudents, (snap)=>{
  records = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  render();
});

// ---------- Form ----------
function resetForm(){
  editingId = null;
  formTitle.textContent = "Add Student";
  saveBtn.textContent = "Save";
  cancelEditBtn.hidden = true;

  studentForm.reset();
  tableColorEl.value = "red";
  setColorUI("red");
}

cancelEditBtn.addEventListener("click", resetForm);

function getFormData(){
  return {
    name: norm(nameEl.value),
    section: norm(sectionEl.value),
    email: norm(emailEl.value),
    note: norm(noteEl.value),
    chromebookNumber: toIntOrNull(chromebookEl.value),
    seatNumber: toIntOrNull(seatEl.value),
    tableColor: norm(tableColorEl.value) || "red"
  };
}
function getPw(){
  return norm(pwEl.value); // may be blank
}
function validate(data){
  if(!data.name) return "Name is required.";
  if(!data.section) return "Section is required.";
  if(data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return "Email looks invalid.";
  if(!COLOR_MAP[data.tableColor]) return "Table color must be red, blue, or yellow.";
  return null;
}

// Create / Update documents:
// - students/{id} : public fields
// - pw_secrets/{id} : { pw } teacher-only
async function upsertStudent(id, data, pw){
  if(!canEdit()){
    alert("Teacher login required to save.");
    openLogin();
    return;
  }

  if(!id){
    // create new student with auto id
    const newRef = doc(collection(db, "students"));
    await setDoc(newRef, {
      ...data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    // store PW separately (if provided)
    await setDoc(doc(db, "pw_secrets", newRef.id), { pw: pw || "" });
    return;
  }

  // update student
  await updateDoc(doc(db, "students", id), {
    ...data,
    updatedAt: serverTimestamp()
  });

  // update PW only if teacher typed something (optional: always write)
  await setDoc(doc(db, "pw_secrets", id), { pw: pw || "" }, { merge: true });

  // if revealed, refresh cache
  if(pwVisible.has(id)){
    pwCache.set(id, pw || "");
  }
}

studentForm.addEventListener("submit", async (e)=>{
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
  }
});

// ---------- Delete ----------
async function deleteStudent(id){
  if(!canEdit()){
    alert("Teacher login required to delete.");
    openLogin();
    return;
  }
  if(!confirm("Delete this record?")) return;

  try{
    await deleteDoc(doc(db, "students", id));
    await deleteDoc(doc(db, "pw_secrets", id));

    pwVisible.delete(id);
    pwCache.delete(id);
    if(editingId === id) resetForm();
  }catch(e){
    alert("Delete failed: " + (e?.message || "Unknown error"));
  }
}

// ---------- Edit ----------
function startEdit(id){
  if(!canEdit()){
    alert("Teacher login required to edit.");
    openLogin();
    return;
  }

  const r = records.find(x => x.id === id);
  if(!r) return;

  editingId = id;
  formTitle.textContent = "Edit Student";
  saveBtn.textContent = "Update";
  cancelEditBtn.hidden = false;

  nameEl.value = r.name ?? "";
  sectionEl.value = r.section ?? "";
  emailEl.value = r.email ?? "";
  noteEl.value = r.note ?? "";
  chromebookEl.value = r.chromebookNumber ?? "";
  seatEl.value = r.seatNumber ?? "";
  tableColorEl.value = r.tableColor ?? "red";
  setColorUI(tableColorEl.value);

  // For safety: don’t auto-fill PW (teacher can reveal via 👁 or type new one)
  pwEl.value = "";

  nameEl.focus();
}

// ---------- PW reveal ----------
async function togglePw(id){
  if(pwVisible.has(id)){
    pwVisible.delete(id);
    render();
    return;
  }

  if(!currentUser){
    alert("Teacher login required to reveal PW.");
    openLogin();
    return;
  }

  try{
    // fetch teacher-only PW
    const snap = await getDoc(doc(db, "pw_secrets", id));
    const pw = snap.exists() ? (snap.data().pw ?? "") : "";
    pwCache.set(id, pw);
    pwVisible.add(id);
    render();
  }catch(e){
    alert("Cannot reveal PW (check Firestore rules): " + (e?.message || "Unknown error"));
  }
}

// ---------- Render ----------
function matchesSearch(r, q){
  if(!q) return true;
  const blob = [r.name, r.section, r.email, r.note, r.chromebookNumber ?? "", r.seatNumber ?? ""].join(" ").toLowerCase();
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
    case "updated_desc":
    default:
      // fallback sort (we subscribe ordered by updatedAt desc already)
      return 0;
  }
}

function render(){
  const q = safeLower(searchInput.value);
  const sortMode = sortSelect.value;

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

    tr.innerHTML = `
      <td><span class="tag" style="background:${tagHex}"></span></td>
      <td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(r.section)}</td>
      <td>${escapeHtml(r.email || "")}</td>

      <td>
        <div class="pwCell">
          <span class="${pwClass}">${escapeHtml(shownPw)}</span>
          <button class="eyeBtn" data-eye="${r.id}" title="Show/Hide PW">${eye}</button>
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

searchInput.addEventListener("input", render);
sortSelect.addEventListener("change", render);

tbody.addEventListener("click", (e)=>{
  const eyeBtn = e.target.closest("button[data-eye]");
  const editBtn = e.target.closest("button[data-edit]");
  const delBtn = e.target.closest("button[data-del]");

  if(eyeBtn) return togglePw(eyeBtn.dataset.eye);
  if(editBtn) return startEdit(editBtn.dataset.edit);
  if(delBtn) return deleteStudent(delBtn.dataset.del);
});

// Initial
resetForm();
