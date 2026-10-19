import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const anchor = '2026-10-13';
export const areas = ['Unge og fællesskaber', 'Grøn omstilling', 'Demokratisk deltagelse'];
export const stages = ['Idé', 'Under udarbejdelse', 'Indsendt', 'Bevilget', 'Afslag'];
const names = ['Horisontfonden', 'Spirepuljen', 'Fælles Fremtid', 'Nordlysfonden', 'Brobyggerpuljen', 'Morgendagens Fond'];
export const applications = Array.from({ length: 24 }, (_, i) => {
  const status = stages[i % stages.length];
  const requested = (i % 6 + 1) * 75000;
  return {
    id: `DEMO-${String(i + 1).padStart(2, '0')}`, foundation: `${names[i % 6]} (demo)`,
    project: `${['Unge i handling', 'Grønne mødesteder', 'Stemmer i byen'][i % 3]} ${Math.floor(i / 3) + 1}`,
    area: areas[i % 3], status, requested, granted: status === 'Bevilget' ? requested * 0.8 : 0,
    deadline: `2026-${i < 12 ? '10' : '11'}-${String(14 + i % 12).padStart(2, '0')}`,
    submitted: ['Indsendt', 'Bevilget', 'Afslag'].includes(status) ? `2026-${String(1 + i % 9).padStart(2, '0')}-10` : null,
    owner: ['Team A', 'Team B', 'Team C'][i % 3],
  };
});
export function summarize(rows) {
  const active = rows.filter(r => !['Bevilget', 'Afslag'].includes(r.status));
  return { count: rows.length, pipeline: active.reduce((s,r) => s+r.requested,0), granted: rows.reduce((s,r) => s+r.granted,0),
    due: rows.filter(r => ['Idé','Under udarbejdelse'].includes(r.status) && r.deadline >= anchor && r.deadline <= '2026-11-12').length };
}
export function buildArtifact() {
  const generatedAt = '2026-10-13T12:00:00Z';
  const source = { id:'demo', label:'Fiktive fondsansøgninger · demo, 13. okt. 2026', path:'scripts/build_dashboard_demo.mjs', query:{
    engine:'SQLite', language:'sql', description:'Deterministisk genererede, fiktive ansøgninger. Ingen eksterne datakilder eller faktiske fondstilsagn.',
    tables_used:['dashboard/demo-applications.json'], filters:['Alle 24 fiktive ansøgninger i 2026. Skæringsdato 13. oktober 2026.'],
    metric_definitions:['Ansøgninger: antal unikke demo-id’er.', 'Aktiv pipeline, DKK: sum af ansøgt beløb for Idé, Under udarbejdelse og Indsendt; ikke forventet indtægt.', 'Bevilget, DKK: sum af tildelt beløb; ikke udbetalinger.', 'Frister næste 30 dage: antal Idé og Under udarbejdelse med frist 13. oktober til og med 12. november 2026.', 'Indsendelser pr. måned: antal ansøgninger med indsendelsesdato i måneden; omfatter senere bevillinger og afslag. Oktober vises til skæringsdato.'] }};
  const literal = JSON.stringify(applications).replaceAll("'", "''");
  const base = `WITH applications AS (SELECT json_extract(value,'$.id') id, json_extract(value,'$.foundation') foundation, json_extract(value,'$.project') project, json_extract(value,'$.area') area, json_extract(value,'$.status') status, json_extract(value,'$.requested') requested, json_extract(value,'$.granted') granted, json_extract(value,'$.deadline') deadline, json_extract(value,'$.submitted') submitted, json_extract(value,'$.owner') owner FROM json_each('${literal}'))`;
  const scopes = `, scopes(area) AS (VALUES ('all'), ${areas.map(a=>`('${a}')`).join(',')})`;
  const queries = {
    applications: `${base} SELECT * FROM applications`,
    deadlines: `${base} SELECT * FROM applications WHERE status IN ('Idé','Under udarbejdelse') AND deadline >= '${anchor}'`,
    summary: `${base}${scopes} SELECT s.area, COUNT(a.id) count, SUM(CASE WHEN status NOT IN ('Bevilget','Afslag') THEN requested ELSE 0 END) pipeline, SUM(granted) granted, SUM(CASE WHEN status IN ('Idé','Under udarbejdelse') AND deadline BETWEEN '${anchor}' AND '2026-11-12' THEN 1 ELSE 0 END) due FROM scopes s LEFT JOIN applications a ON s.area='all' OR s.area=a.area GROUP BY s.area`,
    pipeline: `${base}${scopes}, stages(status,rank) AS (VALUES ${stages.map((a,i)=>`('${a}',${i})`).join(',')}) SELECT s.area,t.status,COUNT(a.id) count,COALESCE(SUM(a.requested),0) requested FROM scopes s CROSS JOIN stages t LEFT JOIN applications a ON (s.area='all' OR s.area=a.area) AND a.status=t.status GROUP BY s.area,t.status ORDER BY s.area,t.rank`,
    monthly: `${base}${scopes}, months(month) AS (VALUES ${Array.from({length:10},(_,i)=>`('2026-${String(i+1).padStart(2,'0')}-01')`).join(',')}) SELECT s.area,m.month,COUNT(a.id) count,COALESCE(SUM(a.requested),0) requested FROM scopes s CROSS JOIN months m LEFT JOIN applications a ON (s.area='all' OR s.area=a.area) AND substr(a.submitted,1,7)=substr(m.month,1,7) GROUP BY s.area,m.month ORDER BY s.area,m.month`
  };
  const datasets = Object.fromEntries(Object.entries(queries).map(([id,sql])=>[id,JSON.parse(execFileSync('sqlite3',['-json',':memory:',sql],{encoding:'utf8'}))]));
  const sources = Object.entries(queries).map(([id,sql])=>({...source,id,query:{...source.query,engine:'SQLite',language:'sql',sql,description:'SQL fra scripts/build_dashboard_demo.mjs beregner snapshot fra de indlejrede, deterministisk genererede demoansøgninger.'}}));
  const cards=[['count','Ansøgninger','Antal fiktive ansøgninger i det valgte område.'],['pipeline','Aktiv pipeline · DKK','Ansøgt beløb i idé, under udarbejdelse og indsendt. Ikke forventet indtægt.'],['granted','Bevilget · DKK','Tildelte beløb; ikke udbetalinger.'],['due','Frister næste 30 dage','Ikke indsendte ansøgninger med frist 13. okt.–12. nov. 2026.']].map(([field,label,description])=>({id:field,dataset:'summary',sourceId:'summary',description,metrics:[{field,label,format:'compact'}]}));
  const charts=[{id:'pipeline', title:'Ansøgninger efter status',subtitle:'Antal ansøgninger · status pr. 13. okt. 2026',type:'horizontalBar',intent:'comparison',dataset:'pipeline',sourceId:'pipeline',layout:'half',encodings:{x:{field:'status',type:'nominal'},y:{field:'count',type:'quantitative',format:'number'}},palette:{kind:'sequential',name:'blue'},labels:{values:'all'}},
    {id:'monthly',title:'Indsendelser pr. måned',subtitle:'Antal · jan.–okt. 2026 · oktober til og med 13. okt.',type:'bar',intent:'trend',dataset:'monthly',sourceId:'monthly',layout:'half',encodings:{x:{field:'month',type:'temporal'},y:{field:'count',type:'quantitative',format:'number'}},palette:{kind:'sequential',name:'blue'},labels:{values:'all'}}];
  const cols=[['foundation','Fond'],['project','Projekt'],['area','Indsatsområde'],['status','Status'],['requested','Ansøgt · DKK'],['granted','Bevilget · DKK'],['deadline','Frist'],['owner','Ansvarlig']].map(([field,label])=>({field,label,type:['requested','granted'].includes(field)?'number':field==='deadline'?'date':'text'}));
  const tables=[{id:'deadlines',title:'Kommende frister',subtitle:'Idéer og ansøgninger under udarbejdelse · sorteret efter frist',dataset:'deadlines',sourceId:'deadlines',defaultSort:{field:'deadline',direction:'asc'},columns:cols.filter(c=>!['granted','status'].includes(c.field))},
    {id:'applications',title:'Alle demoansøgninger',dataset:'applications',sourceId:'applications',defaultSort:{field:'requested',direction:'desc'},columns:cols}];
  return {surface:'dashboard',manifest:{version:1,title:'Fondsblik · demo-dashboard',generatedAt,surface:'dashboard',description:'Overblik over fondsansøgninger, pipeline og kommende frister.',sources,cards,charts,tables,
    filters:[{id:'area',label:'Indsatsområde',dataset:'summary',field:'area',includeAll:true,targets:Object.keys(datasets).filter(k=>k!=='summary').map(dataset=>({dataset,field:'area'}))}],
    blocks:[{id:'intro',type:'markdown',body:'# Fondsblik · demo-dashboard\n\n**DEMODATA · 13. oktober 2026**\n\nPrioritér fondsarbejdet: følg ansøgninger, finansiering og næste frister. Alle navne, beløb og frister er fiktive. Google Drive er ikke tilsluttet. Vælg et indsatsområde for at filtrere hele dashboardet.'},{id:'kpis',type:'metric-strip',cardIds:cards.map(c=>c.id)},...charts.map(c=>({id:`chart-${c.id}`,type:'chart',chartId:c.id,layout:'half'})),...tables.map(t=>({id:`table-${t.id}`,type:'table',tableId:t.id})),{id:'definitions',type:'markdown',sourceId:'summary',body:'### Sådan læses tallene\n\n**Aktiv pipeline** er ansøgt beløb i idé, under udarbejdelse og indsendt. Beløbet er ikke en prognose. **Bevilget** viser tilsagn, ikke udbetalinger. **Frister næste 30 dage** omfatter kun ansøgninger, der endnu ikke er indsendt, fra 13. oktober til og med 12. november 2026.\n\nDette er et fast demosnapshot. Ingen automatisk opdatering eller eksterne forbindelser.'}]},snapshot:{version:1,generatedAt,status:'fixture',datasets},sources};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 await fs.mkdir(path.join(root,'dashboard'),{recursive:true});
 await fs.writeFile(path.join(root,'dashboard/artifact.json'),JSON.stringify(buildArtifact(),null,2)+'\n');
 await fs.writeFile(path.join(root,'dashboard/demo-applications.json'),JSON.stringify(applications,null,2)+'\n');
 console.log(JSON.stringify(summarize(applications)));
}
