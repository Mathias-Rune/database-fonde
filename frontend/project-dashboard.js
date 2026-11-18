const COLORS = { gray: '#b9b8be', blue: '#4e7dba', green: '#76a15f', yellow: '#c39a42', orange: '#c98d48', red: '#8a1a30', purple: '#8c70ae', pink: '#b86d91' };
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = name => `<img src="frontend/icons/${name}.svg" alt="" aria-hidden="true">`;
const shortDate = date => date.toLocaleDateString('da-DK', {day:'numeric',month:'short',timeZone:'UTC'});
const DAY = 86400000;
export function weekStart(value) {
  const date = typeof value === 'string' ? new Date(`${value.slice(0,10)}T12:00:00Z`) : new Date(Date.UTC(value.getFullYear(),value.getMonth(),value.getDate(),12));
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay()+6)%7);
  return date;
}
export function isoWeek(date) {
  const thursday = new Date(date); thursday.setUTCDate(thursday.getUTCDate()+3);
  const year = thursday.getUTCFullYear();
  return {year, number: Math.ceil((((thursday-new Date(Date.UTC(year,0,1,12)))/DAY)+1)/7)};
}
export function weeklyDeadlines(tasks, now = new Date(), offset = 0) {
  const current = weekStart(now);
  const start = new Date(current.getTime() + (offset-11)*7*DAY);
  return Array.from({length:12}, (_, i) => {
    const monday = new Date(start.getTime()+i*7*DAY), sunday = new Date(monday.getTime()+6*DAY);
    const key = monday.toISOString().slice(0,10);
    const due = tasks.filter(task => task.due_on && weekStart(task.due_on).toISOString().slice(0,10) === key);
    const crossYear=monday.getUTCFullYear()!==sunday.getUTCFullYear();
    const fullDate=date=>date.toLocaleDateString("da-DK",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"});
    return {...isoWeek(monday), key, monday, sunday, crossYear, count:due.length, current:monday.getTime()===current.getTime(), range:crossYear?`${fullDate(monday)}–${fullDate(sunday)}`:monday.getUTCMonth()===sunday.getUTCMonth()?`${monday.getUTCDate()}.–${shortDate(sunday)}`:`${shortDate(monday)}–${shortDate(sunday)}`};
  });
}
export function dashboardStats(projects, details) {
  const tasks = details.flatMap(project => project.tasks || []);
  const completed = tasks.filter(task => task.status === 'done').length;
  const statuses = new Map();
  let phaseIndex = 0;
  const phaseColors = [COLORS.red, COLORS.blue, COLORS.purple, COLORS.orange, COLORS.pink];
  for (const project of projects) {
    const label = project.workflow_status_label || ({idea:'Idé',planning:'Planlægning',active:'Aktiv',completed:'Afsluttet',cancelled:'Annulleret'}[project.status]) || project.status;
    const key = label.trim().toLocaleLowerCase("da");
    if (!statuses.has(key)) statuses.set(key,{label,count:0,color:project.status === 'completed' ? COLORS.green : project.status === 'idea' ? COLORS.gray : phaseColors[phaseIndex++ % phaseColors.length]});
    statuses.get(key).count++;
  }
  return {tasks,completed,open:tasks.length-completed,percent:tasks.length?Math.round(completed/tasks.length*100):0,statuses:[...statuses.values()].sort((a,b)=>b.count-a.count)};
}
const weekDescription = week => `${week.range}${week.crossYear ? "" : ` ${week.year}`}`;
let charts = [];
let sort = {key:null, direction:1};
export function destroyDashboardCharts() { charts.forEach(chart=>chart.destroy()); charts=[]; }
function sortedProjects(projects) {
  if (!sort.key) return projects;
  return [...projects].sort((a,b) => {
    const get = p => ({name:p.name,folder:p.folder_name || 'Uden mappe',status:p.workflow_status_label || p.status,tasks:Number(p.open_task_count||0)})[sort.key];
    const left=get(a),right=get(b);
    return sort.direction*(typeof left === 'number' ? left-right : String(left).localeCompare(String(right),'da'));
  });
}
function projectRows(projects) {
  return sortedProjects(projects).map(project => `<tr>
    <td><button class="dashboard-project-open" type="button" data-dashboard-project="${escape(project.project_id)}" title="Åbn ${escape(project.name)}">${icon('chevron-right')}<strong>${escape(project.name)}</strong></button></td>
    <td>${escape(project.folder_name || 'Uden mappe')}</td>
    <td><span class="dashboard-status color-${escape(project.workflow_status_color || 'gray')}"><i aria-hidden="true"></i>${escape(project.workflow_status_label || project.status)}</span></td>
    <td>${Number(project.open_task_count||0)} ${Number(project.open_task_count||0)===1?'åben':'åbne'}</td>
    <td><button class="dashboard-project-edit" type="button" data-dashboard-edit="${escape(project.project_id)}" title="Rediger projekt" aria-label="Rediger ${escape(project.name)}">${icon('more-vertical')}</button></td></tr>`).join('');
}
export function renderDashboard(projects, details) {
  const stats = dashboardStats(projects,details);
  const header = (key,label) => `<th scope="col" data-sort-column="${key}" aria-sort="${sort.key===key?(sort.direction===1?'ascending':'descending'):'none'}"><button type="button" data-dashboard-sort="${key}">${label}${icon('chevron-down')}</button></th>`;
  const progress = projects.map(project => {
    const tasks = details.find(p=>p.project_id===project.project_id)?.tasks || [];
    const done = tasks.filter(t=>t.status==='done').length;
    return `<div class="dashboard-progress-row"><button type="button" data-dashboard-project="${escape(project.project_id)}">${escape(project.name)}</button><progress value="${done}" max="${tasks.length||1}" aria-label="Opgavefremdrift for ${escape(project.name)}: ${done} af ${tasks.length} færdige"></progress><span>${tasks.length ? `${done} / ${tasks.length}` : 'Ingen opgaver'}</span></div>`;
  }).join('');
  return `<section class="dashboard-metrics" aria-label="Nøgletal"><article><strong>${projects.length}</strong><span>Projekter</span></article><article><strong>${stats.open}</strong><span>Åbne opgaver</span></article><article><strong>${projects.reduce((sum,p)=>sum+Number(p.application_count||0),0)}</strong><span>Ansøgninger</span></article><article><strong>${stats.tasks.filter(t=>t.status!=='done'&&!t.assigned_to).length}</strong><span>Uden ansvarlig</span></article></section>
    <section class="dashboard-portfolio" aria-labelledby="dashboardPortfolioTitle"><div class="section-heading"><h2 id="dashboardPortfolioTitle">Projektportefølje</h2><button type="button" class="dashboard-config-action" data-dashboard-config aria-controls="projectConfigPanel">Tilpas mapper og statusser</button></div>
    <div class="dashboard-table-scroll" tabindex="0" role="region" aria-label="Projektportefølje"><table class="dashboard-project-table"><thead><tr>${header('name','Projekt')}${header('folder','Mappe')}${header('status','Status')}${header('tasks','Opgaver')}<th scope="col"><span class="sr-only">Rediger</span></th></tr></thead><tbody>${projectRows(projects)}</tbody></table></div></section>
    <p class="dashboard-completion"><strong>${stats.completed} af ${stats.tasks.length}</strong> opgaver færdige <span aria-hidden="true">·</span> <strong>${stats.percent}%</strong></p>
    <div class="dashboard-chart-grid"><section class="dashboard-chart-panel" aria-labelledby="dashboardStatusTitle"><h3 id="dashboardStatusTitle">Projekter efter status</h3><div class="dashboard-status-chart"><div class="dashboard-donut"><canvas id="projectStatusChart" role="img" aria-label="Projekter efter status: ${escape(stats.statuses.map(s=>`${s.label}: ${s.count}`).join(', '))}"></canvas><div aria-hidden="true"><strong>${projects.length}</strong><span>projekter</span></div></div><ul class="dashboard-chart-legend">${stats.statuses.map(s=>`<li><i style="--chart-color:${s.color}" aria-hidden="true"></i><span>${escape(s.label)}</span><span>${s.count} (${Math.round(s.count/projects.length*100)}%)</span></li>`).join('')}</ul></div></section>
    <section class="dashboard-chart-panel" aria-labelledby="dashboardProgressTitle"><div class="dashboard-chart-heading"><h3 id="dashboardProgressTitle">Opgavefremdrift</h3><div class="dashboard-progress-legend"><span><i class="done"></i>Færdige</span><span><i></i>Åbne</span></div></div><div class="dashboard-progress-list">${progress}</div></section></div>
    <section class="dashboard-chart-panel dashboard-weekly-panel" aria-labelledby="dashboardWeeklyTitle"><div class="dashboard-chart-heading"><div><h3 id="dashboardWeeklyTitle">Opgavefrister pr. uge <span class="dashboard-week-year" data-week-year></span></h3><p>Én prik = én uge · mandag–søndag</p></div><div class="dashboard-week-controls"><button type="button" data-week-shift="-12" aria-label="Forrige 12 uger">${icon('chevron-right')}</button><button type="button" data-week-reset>Denne uge</button><button type="button" data-week-shift="12" aria-label="Næste 12 uger">${icon('chevron-right')}</button></div></div>
    <div class="dashboard-week-summary"><span class="sr-only" data-week-period></span><span>I alt ${stats.tasks.filter(t=>t.due_on).length} opgaver med frist · ${stats.tasks.filter(t=>!t.due_on).length} uden frist</span></div>
    <div class="dashboard-week-scroll" tabindex="0" role="region" aria-label="Ugentlige opgavefrister"><div class="dashboard-week-inner"><div class="dashboard-line-container"><canvas id="projectWeeklyChart" role="img" aria-label="Antal opgavefrister pr. uge. Vælg en uge nedenfor for detaljer."></canvas></div><div class="dashboard-week-labels" data-week-labels></div></div></div><p class="dashboard-week-detail sr-only" data-week-detail aria-live="polite">Vælg en uge for at se antal opgaver med frist.</p></section>`;
}
export function bindDashboard(root, projects, details, {openProject, editProject, openConfig}) {
  root.querySelectorAll('[data-dashboard-project]').forEach(button=>button.addEventListener('click',()=>openProject(button.dataset.dashboardProject)));
  root.querySelectorAll('[data-dashboard-edit]').forEach(button=>button.addEventListener('click',()=>editProject(button.dataset.dashboardEdit)));
  root.querySelector('[data-dashboard-config]')?.addEventListener('click',openConfig);
  root.querySelectorAll('[data-dashboard-sort]').forEach(button=>button.addEventListener('click',()=>{
    const key=button.dataset.dashboardSort;
    sort = {key,direction:sort.key===key?-sort.direction:1};
    root.querySelector('tbody').innerHTML=projectRows(projects);
    root.querySelectorAll('[data-sort-column]').forEach(th=>th.setAttribute('aria-sort',th.dataset.sortColumn===key?(sort.direction===1?'ascending':'descending'):'none'));
    root.querySelectorAll('tbody [data-dashboard-project]').forEach(b=>b.addEventListener('click',()=>openProject(b.dataset.dashboardProject)));
    root.querySelectorAll('tbody [data-dashboard-edit]').forEach(b=>b.addEventListener('click',()=>editProject(b.dataset.dashboardEdit)));
  }));
}
export function mountDashboardCharts(root, projects, details) {
  destroyDashboardCharts();
  const stats=dashboardStats(projects,details), Chart=window.Chart;
  if (!Chart) return;
  Chart.defaults.font.family='Inter, sans-serif';
  const shared={responsive:true,maintainAspectRatio:false,animation:false,font:{family:'Inter, sans-serif'},plugins:{legend:{display:false}}};
  const donut=new Chart(root.querySelector('#projectStatusChart'),{type:'doughnut',data:{labels:stats.statuses.map(s=>s.label),datasets:[{data:stats.statuses.map(s=>s.count),backgroundColor:stats.statuses.map(s=>s.color),borderColor:'#fff',borderWidth:2,hoverOffset:3}]},options:{...shared,cutout:'67%',plugins:{...shared.plugins,tooltip:{callbacks:{label:context=>`${context.label}: ${context.raw} projekter`}}}}});
  charts.push(donut);
  let offset=0, line;
  const renderWeeks=()=>{
    if(line){ line.destroy(); charts=charts.filter(c=>c!==line); }
    const weeks=weeklyDeadlines(stats.tasks,new Date(),offset);
    root.querySelector('[data-week-year]').textContent=weeks[0].year===weeks.at(-1).year?weeks[0].year:`${weeks[0].year}–${weeks.at(-1).year}`;
    const labels=root.querySelector('[data-week-labels]');
    labels.innerHTML=weeks.map((w,index)=>`<button type="button" data-week-index="${index}" class="${w.current?'is-current':''}" aria-label="Uge ${w.number}, ${escape(weekDescription(w))}: ${w.count} opgaver med frist" ${w.current?'aria-current="date"':''}><strong>Uge ${w.number}</strong><span>${escape(w.range)}</span>${w.current?'<em>Denne uge</em>':''}</button>`).join('');
    root.querySelector('[data-week-period]').textContent=`${shortDate(weeks[0].monday)}–${shortDate(weeks.at(-1).sunday)} · ${weeks[0].year===weeks.at(-1).year?weeks[0].year:`${weeks[0].year}–${weeks.at(-1).year}`}`;
    const showWeek=index=>{
      const w=weeks[index];
      root.querySelector('[data-week-detail]').textContent=`Uge ${w.number} · ${weekDescription(w)}: ${w.count} ${w.count===1?'opgave':'opgaver'} med frist.`;
      line.setActiveElements([{datasetIndex:0,index}]);line.tooltip.setActiveElements([{datasetIndex:0,index}],{x:line.scales.x.getPixelForValue(index),y:line.scales.y.getPixelForValue(w.count)});line.update();
      labels.querySelectorAll('button').forEach((button,i)=>button.classList.toggle('is-selected',i===index));
    };
    const weekBands={id:'weekBands',beforeDraw(chart){
      const {ctx,chartArea,scales:{x}}=chart;if(!chartArea)return;
      const width=chartArea.width/weeks.length;
      ctx.save();weeks.forEach((w,i)=>{ctx.fillStyle=w.current?'#f9eef1':i%2?'#fafafa':'#fff';ctx.fillRect(x.getPixelForValue(i)-width/2,chartArea.top,width,chartArea.height);});ctx.restore();
    }};
    line=new Chart(root.querySelector('#projectWeeklyChart'),{type:'line',plugins:[weekBands],data:{labels:weeks.map(w=>`Uge ${w.number}`),datasets:[{label:'Opgaver med frist',data:weeks.map(w=>w.count),borderColor:'#8a1a30',backgroundColor:'#8a1a30',pointBorderColor:'#fff',pointBorderWidth:1.5,pointRadius:5,pointHoverRadius:6,borderWidth:2,tension:0,clip:false}]},options:{...shared,layout:{padding:{top:12,bottom:8}},interaction:{mode:'index',intersect:false},onClick:(event,elements)=>{if(elements.length)showWeek(elements[0].index);},plugins:{legend:{display:false},tooltip:{backgroundColor:'#242226',padding:11,callbacks:{title:items=>{const w=weeks[items[0].dataIndex];return `Uge ${w.number} · ${weekDescription(w)}`;},label:context=>`${context.raw} ${context.raw===1?'opgave':'opgaver'} med frist`}}},scales:{x:{offset:true,border:{display:false},grid:{offset:true,color:'#e8e6e9'},ticks:{display:false}},y:{min:0,suggestedMax:Math.max(2,...weeks.map(w=>w.count)),title:{display:true,text:'Opgaver',align:'end',color:'#6f6b71'},border:{display:false},grid:{color:'#e8e6e9'},ticks:{precision:0,stepSize:1,color:'#6f6b71'}}}}});
    charts.push(line);
    // Match the weekly label columns to the actual plot, including its y-axis gutter.
    labels.style.paddingLeft=`${line.chartArea.left}px`; labels.style.paddingRight=`${line.width-line.chartArea.right}px`;
    line.options.onResize=chart=>{requestAnimationFrame(()=>{labels.style.paddingLeft=`${chart.chartArea.left}px`;labels.style.paddingRight=`${chart.width-chart.chartArea.right}px`;});};
    const scroller=root.querySelector('.dashboard-week-scroll');
    scroller.scrollLeft=weeks.some(w=>w.current)?scroller.scrollWidth-scroller.clientWidth:0;
    labels.querySelectorAll('[data-week-index]').forEach(button=>{button.addEventListener('click',()=>showWeek(Number(button.dataset.weekIndex)));button.addEventListener('focus',()=>showWeek(Number(button.dataset.weekIndex)));});
  };
  renderWeeks();
  root.querySelectorAll('[data-week-shift]').forEach(button=>button.addEventListener('click',()=>{offset+=Number(button.dataset.weekShift);renderWeeks();root.querySelector('[data-week-detail]').textContent='Vælg en uge for at se antal opgaver med frist.';}));
  root.querySelector('[data-week-reset]').addEventListener('click',()=>{offset=0;renderWeeks();});
}
