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

test('data input shared budget panel renders credits and only the server voice estimate', async () => {
    const value = { schemaVersion: 2, quotaMode: 'usage_credits', timezone: 'Asia/Ho_Chi_Minh',
        allowanceMicrocredits: '5000000000', usedMicrocredits: '1000000000', reservedMicrocredits: '500000000',
        legacyCarryMicrocredits: '0', remainingMicrocredits: '3500000000', overdrawnMicrocredits: '0',
        calibrationVersion: 'crm-ai-usage-v1-2026-09', voiceEstimate: {remainingSeconds: 123,profileVersion:'fixture-v1',basis:'Server estimate for this usage profile.'},
        equivalence: {currency:'USD',monthlyTargetNano:'5000000000',invoiceCap:false} };
    const f=fixture(value); await f.controller.setEligible(true);
    assert.equal(f.controller.getState().budget.schemaVersion,2);
    assert.equal(f.controller.getState().budget.remainingMicrocredits,'3500000000');
    assert.ok(f.root.innerHTML.includes('3,500'));
    assert.ok(f.root.innerHTML.includes('Approx. 2.1 voice minutes'));
    assert.ok(f.root.innerHTML.includes('not a guaranteed provider invoice cap'));
    const invalid=fixture({...value,remainingMicrocredits:'3500000001'}); await invalid.controller.setEligible(true);
    assert.equal(invalid.controller.getState().budget,null);
});
