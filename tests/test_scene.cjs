const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const scene=fs.readFileSync('static/warehouse-scene.js','utf8');
const sandbox={window:{},fetch:()=>Promise.resolve({ok:false})};
vm.runInNewContext(scene,sandbox);
const view=sandbox.window.StockPilotWarehouse;
test('10 rayonnages, 40 boutons alignés sur les cases du PNG, et aucun doublon',()=>{
 const db={items:[],shelves:[]},html=view.render(db,'H-3');
 assert.equal((html.match(/data-rx="rack"/g)||[]).length,10);
 assert.equal((html.match(/data-rx="slot"/g)||[]).length,50);
 assert.equal((html.match(/class="sp-real-slot/g)||[]).length,40);
 assert.doesNotMatch(html,/sp-cube-count|sp-rack-marker|sp-bottom-level/);
 assert.match(html,/data-slot="H-3"/);
 assert.match(html,/data-rx="slot" data-slot="H-3"/);
 assert.equal((html.match(/class="sp-real-slot active"/g)||[]).length,1);
});
test('les chiffres affichés reflètent uniquement SQLite',()=>{
 const db={items:[{slot:'H-3'},{slot:'H-3'},{slot:'A-5'}],shelves:[]};
 const html=view.render(db,'H-3');
 assert.equal(view.quantity(db,'H-3'),2);
 assert.equal(view.quantity(db,'A-5'),1);
 assert.equal(view.quantity(db,'J-5'),0);
 assert.match(html,/data-slot="H-3"[^>]*class="sp-real-slot active"[^>]*>[\s\S]*?<strong>2<\/strong>/);
});
