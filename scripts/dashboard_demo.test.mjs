import test from 'node:test';
import assert from 'node:assert/strict';
import { applications, areas, buildArtifact, summarize } from './build_dashboard_demo.mjs';
const artifact=buildArtifact();
test('Demo KPI, pipeline og indsendelser stemmer for alle filtre',()=>{
 for(const area of ['all',...areas]) {
  const rows=applications.filter(r=>area==='all'||r.area===area);
  const summary=artifact.snapshot.datasets.summary.find(r=>r.area===area);
  assert.deepEqual(summary,{area,...summarize(rows)});
  assert.equal(artifact.snapshot.datasets.pipeline.filter(r=>r.area===area).reduce((s,r)=>s+r.count,0),rows.length);
  assert.equal(artifact.snapshot.datasets.monthly.filter(r=>r.area===area).reduce((s,r)=>s+r.count,0),rows.filter(r=>r.submitted).length);
 }
 assert.deepEqual(summarize(applications),{count:24,pipeline:4050000,granted:960000,due:6});
});
test('Frister, kilder og filtre dækker hele dashboardet',()=>{
 assert.equal(new Set(applications.map(r=>r.id)).size,24);
 assert.equal(artifact.snapshot.status,'fixture');
 for(const r of artifact.snapshot.datasets.deadlines) assert.ok(['Idé','Under udarbejdelse'].includes(r.status));
 const filter=artifact.manifest.filters[0];
 const targets=new Set([filter.dataset,...filter.targets.map(t=>t.dataset)]);
 for(const item of [...artifact.manifest.cards,...artifact.manifest.charts,...artifact.manifest.tables]) {
  assert.ok(targets.has(item.dataset));
  assert.ok(artifact.sources.some(s=>s.id===item.sourceId&&s.query.engine==='SQLite'));
 }
});
