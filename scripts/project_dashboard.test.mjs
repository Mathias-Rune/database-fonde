import test from 'node:test';
import assert from 'node:assert/strict';
import { weekStart, isoWeek, weeklyDeadlines, dashboardStats } from '../frontend/project-dashboard.js';

test('weekly deadlines include Monday and Sunday in the same ISO week across month boundaries', () => {
  const tasks=[{due_on:'2026-08-31'},{due_on:'2026-09-06'},{due_on:'2026-09-07'},{due_on:null}];
  const weeks=weeklyDeadlines(tasks,new Date(2026,10,2));
  assert.equal(weeks.length,12);
  assert.equal(weeks.find(w=>w.number===36).count,2);
  assert.equal(weeks.find(w=>w.number===37).count,1);
  assert.equal(weeks.filter(w=>w.current).length,1);
  assert.equal(weeks.at(-1).number,45);
  assert.equal(weeks.at(-1).monday.toISOString().slice(0,10),'2026-11-02');
  assert.equal(weeks.at(-1).sunday.toISOString().slice(0,10),'2026-11-08');
});
test('ISO week labels use the correct year around New Year and retain local calendar dates through DST', () => {
  assert.deepEqual(isoWeek(weekStart('2027-01-01')),{year:2026,number:53});
  assert.deepEqual(isoWeek(weekStart('2027-01-04')),{year:2027,number:1});
  const weeks=weeklyDeadlines([{due_on:'2026-10-25'},{due_on:'2026-10-26'}],new Date(2026,10,2));
  assert.equal(weeks.find(w=>w.number===43).count,1);
  assert.equal(weeks.find(w=>w.number===44).count,1);
  assert.equal(weeklyDeadlines([],new Date(2026,10,2),12)[0].number,46);
  const newYear=weeklyDeadlines([],new Date(2027,0,4)).find(w=>w.number===53);
  assert.equal(newYear.crossYear,true); assert.match(newYear.range,/2026/); assert.match(newYear.range,/2027/);
});
test('dashboard totals include nested tasks, preserve empty projects, and consolidate status label casing', () => {
  const projects=[{project_id:'a',status:'idea',workflow_status_label:'Idea'},{project_id:'b',status:'idea',workflow_status_label:'idea'},{project_id:'c',status:'completed',workflow_status_label:'Afsluttet'}];
  const details=[{project_id:'a',tasks:[{status:'done'},{status:'todo',parent_task_id:'parent'}]},{project_id:'b',tasks:[]},{project_id:'c',tasks:[{status:'done'}]}];
  const stats=dashboardStats(projects,details);
  assert.equal(stats.tasks.length,3); assert.equal(stats.completed,2); assert.equal(stats.open,1); assert.equal(stats.percent,67);
  assert.equal(stats.statuses.length,2); assert.equal(stats.statuses[0].count,2);
  assert.equal(dashboardStats([],[]).percent,0);
});
