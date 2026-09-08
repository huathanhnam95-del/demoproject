'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function fixture(extra={}) {
    const scope={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../../public/js/crm/ai-assistance/budget.js'),'utf8'),scope);
    const value={uid:'staff1',month:'2026-09',currency:'USD',allowanceNano:'5000000000',settledNano:'1000000000',pendingNano:'500000000',availableNano:'3500000000',blocked:false,paidDispatchAvailable:true,...extra};
    const root={innerHTML:'',setAttribute(){},addEventListener(){}};
    const controller=scope.CrmAiBudget.createController({root,endpoint:'/budget',getCurrentUser:()=>({uid:'staff1'}),apiFetchJson:async()=>({budget:value})});
    controller.init();controller.setAccount('staff1');return {scope,value,root,controller};
}
test('native monitored target labels preserve verified metadata and distinguish calculated usage from invoice',async()=>{
    const f=fixture({policyMode:'monitored_target',costBasis:'reported_usage_calculation',possibleOverage:true});await f.controller.setEligible(true);
    for(const text of ['Monthly target','Calculated usage','Pending estimates','Unreserved target','invoice','exceed'])assert.ok(f.root.innerHTML.includes(text),text);
    assert.equal(f.controller.getState().budget.policyMode,'monitored_target');assert.equal(f.controller.getState().budget.possibleOverage,true);
});
test('engineering labels remain unchanged and invalid metadata does not render a trusted balance',async()=>{
    const f=fixture({policyMode:'engineering'});await f.controller.setEligible(true);for(const text of ['Allowance','Settled','Pending','Available'])assert.ok(f.root.innerHTML.includes(text));
    const bad=fixture({policyMode:'<script>'});await bad.controller.setEligible(true);assert.equal(bad.controller.getState().budget,null);
    assert.throws(()=>f.scope.CrmAiBudget.validateBudget({...f.value,possibleOverage:'true'},'staff1'));
});
