'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const harness=require('../../browser/crm-data-input-native/server.cjs');
test('every native scenario requires explicit loopback Auth Firestore and Storage',()=>{
    const valid={FIRESTORE_EMULATOR_HOST:'127.0.0.1:8270',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9173',FIREBASE_STORAGE_EMULATOR_HOST:'127.0.0.1:9370'};
    for(const scenario of ['create','edit','discard-reconnect','image']){
        harness.validateEmulatorHosts({...valid,CRM_NATIVE_SCENARIO:scenario});
        for(const key of Object.keys(valid)){
            const missing={...valid};delete missing[key];assert.throws(()=>harness.validateEmulatorHosts(missing));
            assert.throws(()=>harness.validateEmulatorHosts({...valid,[key]:'storage.googleapis.com:443'}));
        }
    }
});
test('voice and image attachment reloads resolve the named synthetic bucket without default bucket configuration',async()=>{
    for(const scenario of ['create','edit','discard-reconnect','image']){
        const names=[],bucket={file(){throw Error('List configuration must not access an object');}};
        const deps=harness.createStorageDependencies(`demo-${scenario}-fixture`,()=>({bucket(name){assert.ok(name,'Default bucket is unavailable');names.push(name);return bucket;}}));
        assert.equal(await deps.getStorageBucket(),bucket);assert.equal(await deps.getStorageBucket(),bucket);
        assert.deepEqual(names,[`demo-${scenario}-fixture.appspot.com`,`demo-${scenario}-fixture.appspot.com`]);
    }
    assert.throws(()=>harness.createStorageDependencies('production-project'));
});
