const DATA = window.ENC_DATA;
const STORAGE_KEY = "encceja-2026-aulas-v2";
const EXAM_DATE = new Date(2026, 7, 23);
const APP_VERSION = "1.0.1";
const UPDATE_FEED_URL = "https://raw.githubusercontent.com/dozito12/estudos-da-flavia-update/main/update.json";
const AREA_ORDER = ["Matemática", "Linguagens", "Natureza", "Humanas"];
const DAY_NAMES = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

let state = loadState();
let currentView = "dashboard";
let activeQuiz = null;
let activeClassroomLesson = null;
let fileProgressReady = false;

function $(sel){ return document.querySelector(sel); }
function $all(sel){ return [...document.querySelectorAll(sel)]; }
function todayISO(){ return new Date().toISOString().slice(0,10); }
function parseISO(value){ const [y,m,d]=value.split("-").map(Number); return new Date(y,m-1,d); }
function clamp(n,min,max){ return Math.max(min, Math.min(max,n)); }
function daysBetween(a,b){ return Math.ceil((b - a)/(1000*60*60*24)); }
function normalize(v){ return String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase(); }
function escapeHtml(v){ return String(v ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m])); }
function defaultState(){ return { startDate: todayISO(), completed:{}, lessons:{}, attempts:[], errors:[], essays:{} }; }
function loadState(){
  try { return { ...defaultState(), ...JSON.parse(localStorage.getItem(STORAGE_KEY)||"{}") }; }
  catch { return defaultState(); }
}
function persistProgressFile(){
  if(!window.progressStore?.save) return;
  window.progressStore.save({ ...state }).catch(()=>{});
}
function saveState(){
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  persistProgressFile();
}
function mergeProgress(local, backup){
  const base = defaultState();
  const localTime = Date.parse(local?.updatedAt || local?.savedAt || 0) || 0;
  const backupTime = Date.parse(backup?.updatedAt || backup?.savedAt || 0) || 0;
  const primary = backupTime > localTime ? backup : local;
  const secondary = backupTime > localTime ? local : backup;
  return {
    ...base,
    ...(secondary || {}),
    ...(primary || {}),
    completed: { ...(secondary?.completed || {}), ...(primary?.completed || {}) },
    lessons: { ...(secondary?.lessons || {}), ...(primary?.lessons || {}) },
    essays: { ...(secondary?.essays || {}), ...(primary?.essays || {}) },
    attempts: Array.isArray(primary?.attempts) ? primary.attempts : (Array.isArray(secondary?.attempts) ? secondary.attempts : []),
    errors: Array.isArray(primary?.errors) ? primary.errors : (Array.isArray(secondary?.errors) ? secondary.errors : [])
  };
}
async function restoreFileProgress(){
  if(!window.progressStore?.load) return;
  try {
    const backup = await window.progressStore.load();
    if(backup && typeof backup === "object"){
      state = mergeProgress(state, backup);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      $("#startDate").value = state.startDate;
      renderWeekOptions();
      refresh();
      persistProgressFile();
    } else {
      persistProgressFile();
    }
    fileProgressReady = true;
  } catch {
    fileProgressReady = true;
  }
}
function currentWeek(){ return clamp(Math.floor(daysBetween(parseISO(state.startDate), new Date())/7)+1, 1, DATA.planWeeks.length); }
function selectedWeek(){ return Number($("#weekSelect")?.value || currentWeek()); }
function taskId(week, day, index){ return `w${week}-d${day}-t${index}`; }
function lessonId(prefix, id){ return `${prefix}-${id}`; }
function weekData(week){ return DATA.planWeeks[week-1] || DATA.planWeeks[0]; }
function dailyData(week){ return DATA.dailyPlan?.[week-1] || DATA.dailyPlan?.[0]; }
function todayIndex(){ const jsDay = new Date().getDay(); return jsDay===0 ? 6 : jsDay-1; }
function totalPlanDays(){ return (DATA.dailyPlan||[]).reduce((sum, week)=>sum + (week.days||[]).length, 0); }
function defaultPlanCursor(){
  const start = parseISO(state.startDate || todayISO());
  const diff = Math.floor((new Date() - start)/(1000*60*60*24));
  return clamp(diff, 0, Math.max(0, totalPlanDays()-1));
}
function planCursor(){
  const total = totalPlanDays();
  if(!total) return 0;
  return clamp(Number.isFinite(state.dayCursor) ? state.dayCursor : defaultPlanCursor(), 0, total-1);
}
function setPlanCursor(value){
  state.dayCursor = clamp(value, 0, Math.max(0, totalPlanDays()-1));
  saveState();
}
function dayContext(cursor=planCursor()){
  let index = 0;
  for(const week of DATA.dailyPlan || []){
    const days = week.days || [];
    for(let dayIndex=0; dayIndex<days.length; dayIndex++){
      if(index === cursor){
        const routineDay = routineForWeek(week.week)[dayIndex];
        return { week: week.week, dayIndex, absoluteIndex:index, total:totalPlanDays(), day:days[dayIndex], routineDay };
      }
      index++;
    }
  }
  const fallbackWeek = DATA.dailyPlan?.[0];
  return { week:1, dayIndex:0, absoluteIndex:0, total:totalPlanDays(), day:fallbackWeek?.days?.[0], routineDay:routineForWeek(1)[0] };
}
function allLessons(){ return [...(DATA.mathLessons||[]), ...(DATA.punctLessons||[]), ...(DATA.humanLessons||[]), ...(DATA.natureLessons||[]), ...(DATA.generalLessons||[]), ...(DATA.supportLessons||[])]; }
function lessonById(id){ return allLessons().find(l=>l.id===id); }
function lessonPrefixFor(lesson={}){
  if(!lesson.id) return "";
  if((DATA.mathLessons||[]).some(l=>l.id===lesson.id)) return "math";
  if((DATA.punctLessons||[]).some(l=>l.id===lesson.id)) return "punct";
  if((DATA.humanLessons||[]).some(l=>l.id===lesson.id)) return "human";
  if((DATA.natureLessons||[]).some(l=>l.id===lesson.id)) return "nature";
  if((DATA.supportLessons||[]).some(l=>l.id===lesson.id)) return "support";
  return "gen";
}
function classroomRef(lesson){ return lesson?.id ? `${lessonPrefixFor(lesson)}:${lesson.id}` : ""; }
function lessonByClassroomRef(ref){
  const id = String(ref || "").split(":").pop();
  return lessonById(id);
}
function practiceItems(practice){
  if(Array.isArray(practice)) return practice;
  return practice ? [practice] : [];
}
function sourceBadgeInfo(item={}){
  const source = normalize(item.source || item.title || "");
  const url = String(item.url || "");
  if(url.includes("gov.br") || url.includes("inep.gov.br") || source.includes("inep") || source.includes("oficial")) return {label:"Oficial", className:"official"};
  if(source.includes("revisao") || url.startsWith("#") || source.includes("provas e gabaritos")) return {label:"Revisão", className:"review"};
  if(["playlist","youtube","khan","gramatica","debora","jubilut","boaro","manual do mundo","canal recomendado"].some(key=>source.includes(key))) return {label:"Canal recomendado", className:"recommended"};
  return {label:"Apoio", className:"support"};
}
function renderSourceBadge(item){
  const badge = sourceBadgeInfo(item);
  return `<span class="source-badge ${badge.className}">${escapeHtml(badge.label)}</span>`;
}
function sourceLabel(url){
  if(!url) return "Abrir";
  if(url === "#quiz") return "Fazer questões";
  if(url === "#essay") return "Abrir redação";
  if(url === "#materials") return "Ver materiais";
  if(url.includes("khanacademy")) return "Abrir na Khan";
  if(url.includes("gramaticaemvideo")) return "Abrir no Gramática em Vídeo";
  if(url.includes("youtube")) return "Abrir aula";
  if(url.includes("gov.br") || url.includes("inep.gov.br")) return "Abrir material oficial";
  if(url.startsWith("#")) return "Abrir no painel";
  return "Abrir material";
}
function secondaryLinkLabel(url){
  if(!url) return "Vídeo reserva";
  if(url.includes("youtube")) return "Vídeo reserva";
  if(url.includes("gov.br") || url.includes("inep.gov.br")) return "Material oficial";
  return "Material de apoio";
}
function internalClickForHash(hash){
  const view = String(hash||"").replace("#","");
  if(["quiz","essay","errors","dashboard","routine","materials","dailylessons","subjects","math","punctuation","classroom"].includes(view)) switchView(view);
}

function compareVersions(a, b){
  const left = String(a || "0").split(".").map(n => Number.parseInt(n, 10) || 0);
  const right = String(b || "0").split(".").map(n => Number.parseInt(n, 10) || 0);
  const max = Math.max(left.length, right.length);
  for(let i=0; i<max; i++){
    const diff = (left[i] || 0) - (right[i] || 0);
    if(diff) return diff;
  }
  return 0;
}

function showUpdateNotice(update){
  if(!update?.downloadUrl || $("#updateNotice")) return;
  const notice = document.createElement("section");
  notice.id = "updateNotice";
  notice.className = "update-notice";
  notice.setAttribute("role", "dialog");
  notice.setAttribute("aria-label", "Atualizacao disponivel");
  notice.innerHTML = `
    <div>
      <b>Atualizacao disponivel</b>
      <span>${escapeHtml(update.message || "Tem uma versao nova do Estudos da Flavia.")}</span>
      <small>Versao nova: ${escapeHtml(update.version || "")}</small>
    </div>
    <div class="update-actions">
      <a class="primary" target="_blank" rel="noopener noreferrer" href="${escapeHtml(update.downloadUrl)}">Baixar</a>
      <button class="secondary" type="button" data-close-update>Depois</button>
    </div>`;
  document.body.appendChild(notice);
}

async function checkForUpdates(){
  if(!window.fetch || !UPDATE_FEED_URL) return;
  try {
    const response = await fetch(`${UPDATE_FEED_URL}?t=${Date.now()}`, { cache:"no-store" });
    if(!response.ok) return;
    const update = JSON.parse((await response.text()).replace(/^\uFEFF/, ""));
    if(compareVersions(update.version, APP_VERSION) > 0) showUpdateNotice(update);
  } catch {}
}

function registerPwa(){
  if(!("serviceWorker" in navigator)) return;
  if(!/^https?:$/.test(location.protocol)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(()=>{});
  });
}

function findLesson(area, text=""){
  const joined = normalize(`${area} ${text}`);
  const pool = area === "Matemática" ? DATA.mathLessons :
    (area === "Português" || area === "Pontuação") ? DATA.punctLessons :
    (area === "Humanas" || area === "Ciências Humanas") ? DATA.humanLessons :
    (area === "Natureza" || area === "Ciências da Natureza") ? DATA.natureLessons :
    (area === "Linguagens" || area === "Redação") ? DATA.generalLessons :
    (area === "Apoio" || area === "Prova ENCCEJA") ? DATA.supportLessons : [];
  return pool.find(l => joined.includes(normalize(l.title)) || (l.keywords||[]).some(k => joined.includes(normalize(k))));
}
function resolveLesson(task={}){
  if(task.lessonId){
    const byId = lessonById(task.lessonId);
    if(byId) return byId;
  }
  if(task.id){
    const byId = lessonById(task.id);
    if(byId) return byId;
  }
  return findLesson(task.area, task.text || task.title) || (task.url ? task : null);
}
function renderLinks(task){
  const links=[];
  const direct = resolveLesson(task);
  const knownLesson = direct?.id ? lessonById(direct.id) : null;
  if(knownLesson){
    links.push(`<button type="button" data-open-classroom="${escapeHtml(classroomRef(direct))}">Abrir aula</button>`);
  } else if(direct?.url){
    const mainUrl = direct.url;
    const href = escapeHtml(mainUrl);
    const attr = mainUrl.startsWith("#") ? `data-goto="${escapeHtml(mainUrl.slice(1))}" href="${href}"` : `target="_blank" rel="noopener noreferrer" href="${href}"`;
    links.push(`<a ${attr}>${escapeHtml(sourceLabel(mainUrl))}</a>`);
  }
  if(direct?.altUrl && direct.altUrl !== direct.url){
    links.push(`<a target="_blank" rel="noopener noreferrer" href="${escapeHtml(direct.altUrl)}">${escapeHtml(secondaryLinkLabel(direct.altUrl))}</a>`);
  }
  if(!links.length){ links.push(`<a data-goto="materials" href="#materials">Ver materiais</a>`); }
  return `<div class="lesson-links">${links.join("")}</div>`;
}

function routineForWeek(week){
  const pack = dailyData(week);
  if(!pack) return [];
  return pack.days.map((day, dayIndex)=>{
    const tasks=[];
    if(day.math){
      tasks.push({area:"Matemática", lessonId:day.math.lessonId, text:`${day.math.title}. ${day.math.action}`, type:"Khan", source:day.math.source, url:day.math.url, altUrl:day.math.altUrl, extra:day.math.exercise});
    }
    if(day.portuguese){
      const area = day.portuguese.source === "Gramática em Vídeo" ? "Pontuação" : (day.portuguese.title.toLowerCase().includes("redação") ? "Redação" : "Linguagens");
      tasks.push({area, lessonId:day.portuguese.lessonId, text:`${day.portuguese.title}. ${day.portuguese.action}`, type:day.portuguese.source.includes("Gramática") ? "Gramática" : "Português", source:day.portuguese.source, url:day.portuguese.url, altUrl:day.portuguese.altUrl, extra:day.portuguese.exercise});
    }
    if(day.other){
      tasks.push({area:day.other.area, lessonId:day.other.lessonId, text:`${day.other.title}. ${day.other.action}`, type:"curto", source:day.other.source, url:day.other.url, altUrl:day.other.altUrl, extra:day.other.exercise || day.mission});
    }
    if(day.review) tasks.push({area:"Revisão", text:`${day.review.title}. ${day.review.action}`, type:"leve", source:day.review.source, url:day.review.url, extra:day.mission});
    if(day.simulation) tasks.push({area:"Simulado", text:`${day.simulation.title}. ${day.simulation.action}`, type:"prioridade", source:day.simulation.source, url:day.simulation.url, extra:day.mission});
    if(day.essay) tasks.push({area:"Redação", lessonId:day.essay.lessonId, text:`${day.essay.title}. ${day.essay.action}`, type:"opcional", source:day.essay.source, url:day.essay.url, extra:day.mission});
    if(day.planning) tasks.push({area:"Planejamento", lessonId:day.planning.lessonId, text:`${day.planning.title}. ${day.planning.action}`, type:"leve", source:day.planning.source, url:day.planning.url, extra:day.mission});
    if(day.rest) tasks.push({area:"Descanso", text:`${day.rest.title}. ${day.rest.action}`, type:"leve", source:day.rest.source, url:day.rest.url, extra:day.mission});
    tasks.push({area:"Questões", text:day.mission || "Fazer questões e anotar erros.", type:"fixação", source:"Painel", url:"#quiz"});
    return { ...day, name: day.day || DAY_NAMES[dayIndex], load: day.load || "60–90 min", tasks };
  });
}

function allTasksUntil(week=currentWeek()){
  const items=[];
  for(let w=1; w<=week; w++){
    routineForWeek(w).forEach((day, dayIndex)=>{
      day.tasks.forEach((task, index)=>items.push({week:w, dayIndex, day:day.name, id:taskId(w,dayIndex,index), ...task}));
    });
  }
  return items;
}
function todayPlanTasks(){
  const ctx = dayContext();
  return (ctx.routineDay?.tasks || []).map((t,i)=>({week:ctx.week, dayIndex:ctx.dayIndex, day:ctx.routineDay.name, id:taskId(ctx.week,ctx.dayIndex,i), ...t}));
}
function requiredDayTasks(ctx=dayContext()){
  return (ctx.routineDay?.tasks || [])
    .map((t,i)=>({week:ctx.week, dayIndex:ctx.dayIndex, day:ctx.routineDay.name, id:taskId(ctx.week,ctx.dayIndex,i), ...t}))
    .filter(t=>t.type!=="opcional" && t.area!=="Descanso");
}
function dayDoneInfo(ctx=dayContext()){
  const required = requiredDayTasks(ctx);
  const done = required.filter(t=>state.completed[t.id]).length;
  return {required, done, total: required.length, complete: required.length > 0 && done === required.length};
}
function movePlanDay(delta){
  setPlanCursor(planCursor() + delta);
  refresh();
}
function finishPlanDay(){
  const ctx = dayContext();
  requiredDayTasks(ctx).forEach(task => { state.completed[task.id] = true; });
  if(ctx.absoluteIndex < ctx.total - 1) state.dayCursor = ctx.absoluteIndex + 1;
  saveState();
  refresh();
}
function startTodayQuestions(){
  const ctx = dayContext();
  activeQuiz = { mode:"mini", week:ctx.week, questions:makeQuiz("mini", ctx.week), answers:{} };
  if($("#quizMode")) $("#quizMode").value = "mini";
  if($("#quizWeek")) $("#quizWeek").value = ctx.week;
  renderQuizBox();
  switchView("quiz");
}

function switchView(view){
  currentView=view;
  $all(".view").forEach(v=>v.classList.toggle("active", v.id===view));
  $all(".nav-item").forEach(b=>b.classList.toggle("active", b.dataset.view===view));
  const labels={dashboard:"Painel", routine:"Plano diário", dailylessons:"Aulas do dia", classroom:"Sala de Aula", math:"Matemática", punctuation:"Português e Pontuação", subjects:"Aulas de apoio", quiz:"Simulados", errors:"Erros", essay:"Redação", materials:"Materiais"};
  $("#pageTitle").textContent=labels[view]||"Painel";
  window.scrollTo({top:0,behavior:"smooth"});
}

function renderTask(task){
  const checked = state.completed[task.id] ? "checked" : "";
  const done = state.completed[task.id] ? "done" : "";
  const safeText = escapeHtml(task.text);
  const extra = task.extra ? `<small class="task-extra">${escapeHtml(task.extra)}</small>` : "";
  const source = task.source ? `<small class="task-source">Fonte: ${escapeHtml(task.source)} ${renderSourceBadge(task)}</small>` : "";
  return `<div class="task-wrap ${done}"><label class="task ${done}"><input type="checkbox" data-task="${escapeHtml(task.id)}" ${checked}><span><b>${escapeHtml(task.area)}</b>${safeText}${source}<small>${task.day ? `Semana ${task.week} • ${escapeHtml(task.day)}` : ""}</small>${extra}</span><em class="pill tag">${escapeHtml(task.type)}</em></label>${renderLinks(task)}</div>`;
}
function renderTodayTask(task){
  const checked = state.completed[task.id] ? "checked" : "";
  const done = state.completed[task.id] ? "done" : "";
  const title = String(task.text || "").split(". ")[0];
  const extra = task.extra ? `<small class="task-extra">${escapeHtml(task.extra)}</small>` : "";
  return `<div class="task-wrap today-task ${done}"><label class="task ${done}"><input type="checkbox" data-task="${escapeHtml(task.id)}" ${checked}><span><b>${escapeHtml(task.area)}</b>${escapeHtml(title)}${extra}</span></label>${renderLinks(task)}</div>`;
}
function renderDashboard(){
  const ctx = dayContext();
  const week = ctx.week;
  const day = ctx.routineDay;
  const total = allTasksUntil(DATA.planWeeks.length).filter(t=>t.type!=="opcional" && t.area!=="Descanso").length;
  const done = allTasksUntil(DATA.planWeeks.length).filter(t=>state.completed[t.id] && t.type!=="opcional" && t.area!=="Descanso").length;
  const progress = Math.round((done/total)*100);
  const left = Math.max(0, daysBetween(new Date(), EXAM_DATE));
  const last = state.attempts?.[state.attempts.length-1];
  const info = dayDoneInfo(ctx);
  if($("#daysToExam")) $("#daysToExam").textContent = left;
  if($("#todayCursorBadge")) $("#todayCursorBadge").textContent = `Dia ${ctx.absoluteIndex + 1} de ${ctx.total}`;
  if($("#todayTitle")) $("#todayTitle").textContent = `Semana ${week} • ${day?.name || DAY_NAMES[ctx.dayIndex]}`;
  if($("#todaySummary")) $("#todaySummary").textContent = `${day?.load || "60-90 min"} de estudo. Progresso geral: ${progress}%. ${last ? `Último simulado: ${last.percent}%.` : "Quando terminar, faça as questões do dia."}`;
  if($("#todayProgress")) $("#todayProgress").textContent = `${info.done}/${info.total} feito`;
  const humanDone = (DATA.humanLessons||[]).filter(l=>state.lessons[lessonId("human", l.id)]).length;
  const natureDone = (DATA.natureLessons||[]).filter(l=>state.lessons[lessonId("nature", l.id)]).length;
  if($("#kpiHumanLessons")) $("#kpiHumanLessons").textContent = `${humanDone}/${(DATA.humanLessons||[]).length}`;
  if($("#kpiNatureLessons")) $("#kpiNatureLessons").textContent = `${natureDone}/${(DATA.natureLessons||[]).length}`;
  if($("#todayPlan")){
    const completeNote = info.complete ? `<div class="finish-note"><b>Dia concluído.</b><span>Você pode continuar para o próximo ou voltar um dia para revisar.</span></div>` : "";
    $("#todayPlan").innerHTML = `${completeNote}${todayPlanTasks().map(renderTodayTask).join("") || `<p class="note">Nenhuma tarefa para este dia.</p>`}`;
  }
  if($("#prevPlanDay")) $("#prevPlanDay").disabled = ctx.absoluteIndex <= 0;
  if($("#nextPlanDay")) $("#nextPlanDay").disabled = ctx.absoluteIndex >= ctx.total - 1;
}

function renderWeekOptions(){
  const opts = DATA.planWeeks.map(w=>`<option value="${w.week}">Semana ${w.week} — ${escapeHtml(w.title)}</option>`).join("");
  $("#weekSelect").innerHTML = opts;
  $("#dailyWeekSelect").innerHTML = opts;
  $("#quizWeek").innerHTML = opts;
  $("#weekSelect").value = currentWeek();
  $("#dailyWeekSelect").value = currentWeek();
  $("#quizWeek").value = currentWeek();
}
function renderRoutine(){
  const week = selectedWeek(); const w = weekData(week);
  const days = routineForWeek(week);
  $("#routineWeek").innerHTML = `<section class="week-card"><span class="pill">${escapeHtml(w.phase)}</span><h3>Semana ${week}: ${escapeHtml(w.title)}</h3><p class="note"><b>Objetivo:</b> ${escapeHtml(w.goal)}</p><div class="day-grid">${days.map((day,di)=>`<article class="day-card"><h4>${escapeHtml(day.name)} <small>(${escapeHtml(day.load)})</small></h4>${day.tasks.map((t,i)=>renderTask({week,dayIndex:di,day:day.name,id:taskId(week,di,i),...t})).join("")}</article>`).join("")}</div></section>`;
}
function renderDailyLessons(){
  const week = Number($("#dailyWeekSelect")?.value || currentWeek());
  const days = routineForWeek(week);
  const today = week === currentWeek() ? todayIndex() : -1;
  $("#dailyLessonsBox").innerHTML = `<div class="daily-grid">${days.map((day,di)=>{
    const daily = dailyData(week).days[di];
    if(daily.math || daily.portuguese || daily.other){
      const otherClass = normalize(daily.other?.area).includes("human") ? "human" : "nature";
      const otherLabel = normalize(daily.other?.area).includes("human") ? "Ciências Humanas" : "Ciências da Natureza";
      const portugueseSource = normalize(daily.portuguese?.source || "");
      const portugueseLabel = portugueseSource.includes("redacao") ? "Redação" : (portugueseSource.includes("linguagens") ? "Linguagens" : "Português/Pontuação");
      return `<article class="daily-card ${di===today?"today":""}"><div class="daily-head"><span class="pill">${escapeHtml(day.name)}</span><b>${escapeHtml(day.load)}</b></div><h4>${di===today?"Aulas de hoje":"Aulas do dia"}</h4>
        ${daily.math ? `<div class="daily-lesson math"><b>Matemática</b><span>${escapeHtml(daily.math.title)}</span><p>${escapeHtml(daily.math.exercise)}</p>${renderLinks({area:"Matemática", lessonId:daily.math.lessonId, text:daily.math.title, url:daily.math.url, altUrl:daily.math.altUrl})}</div>` : ""}
        ${daily.portuguese ? `<div class="daily-lesson port"><b>${escapeHtml(portugueseLabel)}</b><span>${escapeHtml(daily.portuguese.title)}</span><p>${escapeHtml(daily.portuguese.exercise)}</p>${renderLinks({area:portugueseLabel, lessonId:daily.portuguese.lessonId, text:daily.portuguese.title, url:daily.portuguese.url, altUrl:daily.portuguese.altUrl})}</div>` : ""}
        ${daily.other ? `<div class="daily-lesson ${otherClass}"><b>${otherLabel} ${renderSourceBadge(daily.other)}</b><span>${escapeHtml(daily.other.title)}</span><p>${escapeHtml(daily.other.exercise || daily.other.action || "Estudo curto com questões.")}</p>${renderLinks({area:daily.other.area, lessonId:daily.other.lessonId, text:daily.other.title, source:daily.other.source, url:daily.other.url, altUrl:daily.other.altUrl})}</div>` : ""}
        <p class="note"><b>Fechamento:</b> ${escapeHtml(daily.mission || "Anotar erros e marcar conclusão.")}</p></article>`;
    }
    return `<article class="daily-card ${di===today?"today":""}"><div class="daily-head"><span class="pill">${escapeHtml(day.name)}</span><b>${escapeHtml(day.load)}</b></div><h4>Revisão e recuperação</h4>${day.tasks.map((t,i)=>renderTask({week,dayIndex:di,day:day.name,id:taskId(week,di,i),...t})).join("")}</article>`;
  }).join("")}</div>`;
}

function lessonCards(lessons, prefix){
  return lessons.map(l=>{
    const id=lessonId(prefix,l.id || normalize(l.title));
    const done=state.lessons[id];
    const practiceList = practiceItems(l.practice);
    const practice = practiceList.length ? `<p class="note"><b>Treino:</b> ${practiceList.map(escapeHtml).join(" • ")}</p>` : "";
    const body = l.steps ? `<ul>${l.steps.map(s=>`<li>${escapeHtml(s)}</li>`).join("")}</ul><div class="example"><b>Exemplo:</b> ${escapeHtml(l.example)}</div><p class="note"><b>Treino:</b> ${escapeHtml(l.practice)}</p>` :
      l.rule ? `<p><b>Regra:</b> ${escapeHtml(l.rule)}</p><div class="example"><b>Errado:</b> ${escapeHtml(l.wrong)}<br><b>Certo:</b> ${escapeHtml(l.right)}</div><p class="note"><b>Treino:</b> ${escapeHtml(l.practice)}</p>` :
      l.objective ? `<p><b>Objetivo:</b> ${escapeHtml(l.objective)}</p>${practice}` :
      `<ul>${(l.items||[]).map(i=>`<li>${escapeHtml(i)}</li>`).join("")}</ul>${practice}`;
    const areaForLesson = prefix === "math" ? "Matemática" : prefix === "punct" ? "Pontuação" : (l.area || "ENCCEJA");
    return `<article class="lesson-card ${done?"done":""}"><div class="lesson-meta"><span>${escapeHtml(l.level || l.area)}</span><span>${escapeHtml(l.time)}</span><span>${escapeHtml(l.source || "Painel")}</span>${renderSourceBadge(l)}</div><h4>${escapeHtml(l.title)}</h4>${body}${renderLinks({area:areaForLesson,lessonId:l.id,text:l.title,source:l.source,url:l.url,altUrl:l.altUrl})}<button class="secondary" data-lesson="${id}">${done?"Marcar como não visto":"Marcar como estudado"}</button></article>`;
  }).join("");
}
function renderLessons(container, lessons, prefix){
  $(container).innerHTML = lessonCards(lessons, prefix);
}
function renderSubjectGroup(group){
  const countLabel = `${group.lessons.length} ${group.lessons.length === 1 ? "aula" : "aulas"}`;
  return `<section class="subject-section" data-subject-area="${escapeHtml(group.filter)}"><div class="panel-head"><h3>${escapeHtml(group.title)}</h3><span class="pill">${countLabel}</span></div><div class="lesson-grid ${group.small ? "small" : ""}">${lessonCards(group.lessons, group.prefix)}</div></section>`;
}
function renderSubjectLessons(){
  const filter = $("#subjectFilter")?.value || "all";
  const support = DATA.supportLessons || [];
  const groups = [
    {filter:"matematica", title:"Apoio de Matemática", prefix:"support", lessons:support.filter(l=>normalize(l.area).includes("matematica"))},
    {filter:"prova", title:"Apoio Prova ENCCEJA", prefix:"support", lessons:support.filter(l=>normalize(l.area).includes("prova"))},
    {filter:"pontuacao", title:"Apoio de Pontuação", prefix:"support", lessons:support.filter(l=>normalize(l.area).includes("pontuacao"))},
    {filter:"redacao", title:"Apoio de Redação", prefix:"support", lessons:support.filter(l=>normalize(l.area).includes("redacao"))},
    {filter:"natureza", title:"Apoio de Ciências da Natureza", prefix:"support", lessons:support.filter(l=>normalize(l.area).includes("natureza"))},
    {filter:"humanas", title:"Apoio de Ciências Humanas", prefix:"support", lessons:support.filter(l=>normalize(l.area).includes("humanas"))}
  ].filter(group => (filter === "all" || group.filter === filter) && group.lessons.length);
  $("#generalLessons").innerHTML = groups.length ? groups.map(renderSubjectGroup).join("") : `<section class="panel"><p class="note">Nenhuma aula de apoio cadastrada neste filtro ainda. Pode mandar novos links que eu adiciono aqui.</p></section>`;
}
function renderAllLessons(){
  if($("#mathLessons")) renderLessons("#mathLessons", DATA.mathLessons, "math");
  if($("#punctLessons")) renderLessons("#punctLessons", DATA.punctLessons, "punct");
  renderSubjectLessons();
}

function renderClassroom(lesson=activeClassroomLesson){
  const box = $("#classroomBox");
  if(!box) return;
  if(!lesson){
    box.innerHTML = `<section class="panel"><h3>Sala de Aula</h3><p class="note">Escolha uma aula no Painel ou em Aulas de apoio.</p><div class="lesson-links"><a data-goto="dashboard" href="#dashboard">Voltar ao painel</a><a data-goto="subjects" href="#subjects">Ver aulas de apoio</a></div></section>`;
    return;
  }
  activeClassroomLesson = lesson;
  const prefix = lessonPrefixFor(lesson);
  const doneKey = lessonId(prefix, lesson.id);
  const done = state.lessons[doneKey];
  const practice = practiceItems(lesson.practice);
  const objective = lesson.objective || lesson.rule || lesson.example || "Estude a aula principal e faça o treino curto para fixar.";
  const practiceHtml = practice.length ? practice.map(item=>`<li>${escapeHtml(item)}</li>`).join("") : `<li>Estudar a aula principal.</li><li>Anotar os pontos que mais caem.</li><li>Fazer questões do painel.</li>`;
  const mainUrl = lesson.url || "#materials";
  const mainButton = mainUrl.startsWith("#") ?
    `<a class="primary classroom-main" data-goto="${escapeHtml(mainUrl.slice(1))}" href="${escapeHtml(mainUrl)}">Aula principal</a>` :
    `<a class="primary classroom-main" target="_blank" rel="noopener noreferrer" href="${escapeHtml(mainUrl)}">Aula principal</a>`;
  const materialButton = lesson.materialUrl ? `<a class="secondary classroom-material" target="_blank" rel="noopener noreferrer" href="${escapeHtml(lesson.materialUrl)}">Material oficial</a>` : "";
  box.innerHTML = `<article class="classroom-card">
    <div class="classroom-head">
      <span class="pill">Sala de Aula</span>
      ${renderSourceBadge(lesson)}
    </div>
    <h3>${escapeHtml(lesson.title)}</h3>
    <p class="classroom-meta">${escapeHtml(lesson.area || "ENCCEJA")} • ${escapeHtml(lesson.level || "Aula")} • ${escapeHtml(lesson.time || "Estudo curto")} • ${escapeHtml(lesson.source || "Painel")}</p>
    <section class="classroom-step">
      <h4>Objetivo</h4>
      <p>${escapeHtml(objective)}</p>
    </section>
    <section class="classroom-step">
      <h4>Prática da aula</h4>
      <ol>${practiceHtml}</ol>
    </section>
    <div class="classroom-actions">
      ${mainButton}
      ${materialButton}
      <button class="secondary" type="button" data-classroom-complete="${escapeHtml(doneKey)}">${done ? "Marcar como não estudado" : "Marcar como estudado"}</button>
      <button class="secondary" type="button" data-goto="dashboard">Voltar ao painel</button>
    </div>
  </article>`;
}
function openClassroom(ref){
  const lesson = typeof ref === "string" ? lessonByClassroomRef(ref) : ref;
  if(!lesson) return;
  renderClassroom(lesson);
  switchView("classroom");
}

function rng(seed){ let s = seed % 2147483647; if(s<=0) s+=2147483646; return ()=> (s = s*16807%2147483647)/2147483647; }
function shuffle(arr, seed){ const a=[...arr]; const r=rng(seed); for(let i=a.length-1;i>0;i--){ const j=Math.floor(r()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function usedQuestionIds(){ return new Set((state.attempts||[]).flatMap(a=>a.questionIds||[])); }
function quizCounts(mode){
  if(mode==="mini") return {"Matemática":4,"Linguagens":3,"Natureza":2,"Humanas":1};
  if(mode==="strong") return {"Matemática":12,"Linguagens":12,"Natureza":8,"Humanas":8};
  return {"Matemática":7,"Linguagens":6,"Natureza":4,"Humanas":3};
}
function makeQuiz(mode, week){
  const counts=quizCounts(mode); const used=usedQuestionIds(); const seed=Date.now()%100000 + (state.attempts?.length||0)*97 + week*31;
  const quiz=[]; const weekText=normalize(Object.values(weekData(week)).join(" "));
  AREA_ORDER.forEach((area,areaIndex)=>{
    const pool=DATA.questionBank.filter(q=>q.area===area);
    const priority=pool.filter(q=>q.tags?.some(t=>weekText.includes(normalize(t))) || weekText.includes(normalize(q.topic)));
    const first=[...priority.filter(q=>!used.has(q.id)), ...pool.filter(q=>!used.has(q.id) && !priority.includes(q)), ...priority, ...pool];
    const unique=[]; const seen=new Set();
    shuffle(first, seed+areaIndex*101).forEach(q=>{ if(!seen.has(q.id) && unique.length<counts[area]){ unique.push(q); seen.add(q.id); } });
    quiz.push(...unique);
  });
  return shuffle(quiz, seed+909);
}
function renderQuizStart(){
  if(!activeQuiz){ activeQuiz = { mode:"weekly", week:currentWeek(), questions:makeQuiz("weekly", currentWeek()), answers:{} }; }
  renderQuizBox();
}
function renderQuizBox(){
  const labels={mini:"Rápido",weekly:"Semanal",strong:"Forte"};
  const qs=activeQuiz.questions;
  $("#quizBox").innerHTML = `<div class="panel-head"><h3>${labels[activeQuiz.mode]} — Semana ${activeQuiz.week}</h3><span class="pill">${qs.length} questões</span></div><form id="quizForm">${qs.map((q,i)=>`<div class="quiz-question"><strong>${i+1}. [${escapeHtml(q.area)}] ${escapeHtml(q.question)}</strong><div class="options">${q.options.map((op,oi)=>`<label><input type="radio" name="q${i}" value="${oi}"><span>${String.fromCharCode(65+oi)}) ${escapeHtml(op)}</span></label>`).join("")}</div></div>`).join("")}</form><button id="gradeQuiz" class="primary">Corrigir simulado</button><div id="quizResult" class="result-box hidden"></div>`;
}
function gradeQuiz(){
  if(!activeQuiz) return;
  const answers={}; let hits=0; const areaStats={}; const newErrors=[];
  activeQuiz.questions.forEach((q,i)=>{
    const selected = $(`input[name="q${i}"]:checked`);
    const ans = selected ? Number(selected.value) : -1;
    answers[q.id]=ans;
    areaStats[q.area] ||= {hits:0,total:0}; areaStats[q.area].total++;
    if(ans===q.answer){ hits++; areaStats[q.area].hits++; }
    else newErrors.push({ id:`e${Date.now()}-${q.id}`, date:todayISO(), week:activeQuiz.week, area:q.area, topic:q.topic, question:q.question, selected: ans>=0 ? q.options[ans] : "Sem resposta", correct:q.options[q.answer], explanation:q.explanation, reviewed:false });
  });
  const percent=Math.round(hits/activeQuiz.questions.length*100);
  const attempt={ date:todayISO(), mode:activeQuiz.mode, week:activeQuiz.week, hits, total:activeQuiz.questions.length, percent, areaStats, questionIds:activeQuiz.questions.map(q=>q.id) };
  state.attempts.push(attempt); state.errors.push(...newErrors); saveState();
  const bars = AREA_ORDER.map(a=>{ const s=areaStats[a]||{hits:0,total:0}; const p=s.total?Math.round(s.hits/s.total*100):0; return `<div><b>${a}: ${s.hits}/${s.total}</b><div class="bar"><span style="width:${p}%"></span></div></div>`; }).join("");
  $("#quizResult").classList.remove("hidden");
  $("#quizResult").innerHTML = `<h3>Resultado: ${hits}/${activeQuiz.questions.length} (${percent}%)</h3><div class="area-bars">${bars}</div><p>${newErrors.length ? `${newErrors.length} erro(s) foram enviados ao caderno de erros.` : "Excelente: nenhum erro neste simulado."}</p><button class="secondary" id="goErrors">Ver caderno de erros</button>`;
  renderDashboard(); renderErrors();
}
function renderErrors(){
  const filter=$("#errorFilter")?.value || "all";
  const errors=(state.errors||[]).filter(e=>filter==="all" || e.area===filter);
  if(!errors.length){ $("#errorList").innerHTML=`<section class="panel"><p class="note">Nenhum erro registrado neste filtro. Faça um simulado para alimentar o caderno.</p></section>`; return; }
  $("#errorList").innerHTML=errors.slice().reverse().map(e=>`<article class="error-card ${e.reviewed?"reviewed":""}"><span class="pill">${escapeHtml(e.area)} • ${escapeHtml(e.topic)}</span><h4>${escapeHtml(e.question)}</h4><p><b>Sua resposta:</b> ${escapeHtml(e.selected)}<br><b>Correta:</b> ${escapeHtml(e.correct)}</p><p><b>Explicação:</b> ${escapeHtml(e.explanation)}</p><button class="secondary" data-review="${escapeHtml(e.id)}">${e.reviewed?"Marcar como não revisado":"Marcar como revisado"}</button></article>`).join("");
}

function renderEssay(){
  $("#essayTopic").innerHTML = DATA.essayTopics.map((t,i)=>`<option value="${i}">${escapeHtml(t)}</option>`).join("");
  const key=$("#essayTopic").value || "0";
  $("#essayDraft").value = state.essays[key] || "";
}
function refresh(){ renderDashboard(); renderRoutine(); renderDailyLessons(); renderAllLessons(); renderClassroom(); renderErrors(); renderEssay(); }
function exportProgress(){
  const blob = new Blob([JSON.stringify(state,null,2)], {type:"application/json"});
  const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download="progresso-encceja-2026.json"; a.click(); URL.revokeObjectURL(url);
}

function initEvents(){
  $all(".nav-item").forEach(b=>b.addEventListener("click",()=>switchView(b.dataset.view)));
  document.body.addEventListener("change", e=>{
    if(e.target.matches("[data-task]")){ state.completed[e.target.dataset.task]=e.target.checked; saveState(); renderDashboard(); renderRoutine(); renderDailyLessons(); }
    if(e.target.id==="weekSelect") renderRoutine();
    if(e.target.id==="dailyWeekSelect") renderDailyLessons();
    if(e.target.id==="subjectFilter") renderSubjectLessons();
    if(e.target.id==="errorFilter") renderErrors();
    if(e.target.id==="essayTopic") $("#essayDraft").value=state.essays[e.target.value]||"";
    if(e.target.id==="startDate"){ state.startDate=e.target.value; state.dayCursor=defaultPlanCursor(); saveState(); renderWeekOptions(); refresh(); }
  });
  document.body.addEventListener("click", e=>{
    const goto=e.target.closest("[data-goto]");
    if(goto){ e.preventDefault(); internalClickForHash(goto.dataset.goto || goto.getAttribute("href")); }
    const openLesson=e.target.closest("[data-open-classroom]");
    if(openLesson){ e.preventDefault(); openClassroom(openLesson.dataset.openClassroom); }
    const classroomDone=e.target.closest("[data-classroom-complete]");
    if(classroomDone){ const id=classroomDone.dataset.classroomComplete; state.lessons[id]=!state.lessons[id]; saveState(); renderClassroom(); renderAllLessons(); renderDashboard(); }
    const lesson=e.target.closest("[data-lesson]");
    if(lesson){ const id=lesson.dataset.lesson; state.lessons[id]=!state.lessons[id]; saveState(); renderAllLessons(); renderDashboard(); }
    const review=e.target.closest("[data-review]");
    if(review){ const item=state.errors.find(x=>x.id===review.dataset.review); if(item){ item.reviewed=!item.reviewed; saveState(); renderErrors(); } }
    if(e.target.id==="newQuiz"){ const mode=$("#quizMode").value; const week=Number($("#quizWeek").value); activeQuiz={mode,week,questions:makeQuiz(mode,week),answers:{}}; renderQuizBox(); }
    if(e.target.id==="gradeQuiz") gradeQuiz();
    if(e.target.id==="goErrors") switchView("errors");
    if(e.target.id==="prevPlanDay") movePlanDay(-1);
    if(e.target.id==="nextPlanDay") movePlanDay(1);
    if(e.target.id==="finishPlanDay") finishPlanDay();
    if(e.target.id==="startTodayQuiz") startTodayQuestions();
    if(e.target.closest("[data-close-update]")) $("#updateNotice")?.remove();
  });
  $("#useToday")?.addEventListener("click",()=>{ state.startDate=todayISO(); state.dayCursor=0; $("#startDate").value=state.startDate; saveState(); renderWeekOptions(); refresh(); });
  $("#clearWeek")?.addEventListener("click",()=>{ const w=selectedWeek(); routineForWeek(w).forEach((d,di)=>d.tasks.forEach((_,i)=>delete state.completed[taskId(w,di,i)])); saveState(); refresh(); });
  $("#clearReviewed")?.addEventListener("click",()=>{ state.errors=(state.errors||[]).filter(e=>!e.reviewed); saveState(); renderErrors(); renderDashboard(); });
  $("#saveEssay")?.addEventListener("click",()=>{ state.essays[$("#essayTopic").value]=$("#essayDraft").value; saveState(); $("#essayMessage").textContent="Salvo."; setTimeout(()=>$("#essayMessage").textContent="",1600); });
  $("#exportProgress")?.addEventListener("click",exportProgress);
  $("#printPage")?.addEventListener("click",()=>window.print());
}
function init(){
  $("#startDate").value=state.startDate;
  renderWeekOptions(); renderQuizStart(); initEvents(); refresh();
  restoreFileProgress();
  checkForUpdates();
  registerPwa();
}
init();
window.addEventListener("beforeunload", () => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  if(fileProgressReady) persistProgressFile();
});

// Tela de entrada personalizada preservada do painel original.
function initWelcomeGate(){
  const welcome = document.querySelector('#welcomeScreen');
  const input = document.querySelector('#programPassword');
  const button = document.querySelector('#startProgram');
  const message = document.querySelector('#passwordMessage');
  const prank = document.querySelector('#passwordPrank');
  const prankStepOne = document.querySelector('#prankStepOne');
  const prankStepTwo = document.querySelector('#prankStepTwo');
  const prankNext = document.querySelector('#prankNext');
  const prankClose = document.querySelector('#prankClose');
  const unlock = () => {
    document.body.classList.remove('locked');
    document.body.classList.add('unlocked');
    if (welcome) welcome.classList.add('hidden');
  };
  const showPrank = () => {
    if (!prank) return;
    prank.classList.remove('hidden');
    prankStepOne?.classList.remove('hidden');
    prankStepTwo?.classList.add('hidden');
    prankNext?.focus();
  };
  const closePrank = () => {
    prank?.classList.add('hidden');
    input.value = '';
    input.focus();
  };
  if (!welcome || !input || !button) {
    document.body.classList.remove('locked');
    document.body.classList.add('unlocked');
    return;
  }
  prankNext?.addEventListener('click', () => {
    prankStepOne?.classList.add('hidden');
    prankStepTwo?.classList.remove('hidden');
    prankClose?.focus();
  });
  prankClose?.addEventListener('click', closePrank);
  button.addEventListener('click', () => {
    const password = input.value.trim();
    if (password === '0605') {
      if (message) message.textContent = '';
      unlock();
      try { localStorage.setItem('encceja-flavia-unlocked', '1'); } catch {}
      return;
    }
    if (message) message.textContent = '';
    showPrank();
  });
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') button.click(); });
}
initWelcomeGate();
