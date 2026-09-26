(function (scope) {
    'use strict';
    // Download together, execute in dependency order. Preloading never runs modules.
    const scripts = [
        ["js/crm/projects/assistant.js?v=20260919-v2.0.13&cb=mute-response&audit=20260926-smooth-1", "CrmProjectsAssistant"],
        ["js/crm/projects/state.js?v=20260919-v2.0.13&phase=9&audit=20260926-smooth-1", "CrmProjectsBoardState"],
        ["js/crm/projects/date-picker.js?v=20260919-v2.0.13&phase=5&pv2=f0caccb1-local1&audit=20260926-smooth-1", "CrmProjectsDatePicker"],
        ["js/crm/projects/discussion.js?v=20260919-v2.0.13&phase=6&pv2=f0caccb1-local1&audit=20260926-smooth-1", "CrmProjectsDiscussion"],
        ["js/crm/projects/recovery.js?v=20260919-v2.0.13&phase=4&audit=20260926-smooth-1", "CrmProjectsRecovery"],
        ["js/crm/projects/gantt.js?v=20260926-gantt-1&audit=20260926-smooth-1", "CrmProjectsGantt"],
        ["js/crm/projects/views.js?v=20260919-v2.0.13&phase=5&pv2=f0caccb1-local1&audit=20260926-smooth-1", "CrmProjectsViews"],
        ["js/crm/projects/notifications.js?v=20260919-v2.0.13&phase=6&audit=20260926-smooth-1", "CrmProjectsNotifications"],
        ["js/crm/projects/automation-definition-editor.js?v=20260919-v2.0.13&phase=7&audit=20260926-smooth-1", "CrmAutomationDefinitionEditor"],
        ["js/crm/projects/automations-renderer.js?v=20260919-v2.0.13&phase=7&pv2=f0caccb1-local1&audit=20260926-smooth-1", "CrmAutomationsRenderer"],
        ["js/crm/projects/automations.js?v=20260919-v2.0.13&phase=9&pv2=f0caccb1-local1&audit=20260926-smooth-1", "CrmAutomations"],
        ["js/crm/projects/remote-observer.js?v=20260919-v2.0.13&observer=remote&audit=20260926-smooth-1", "CrmProjectsRemoteObserver"],
        ["js/crm/projects/presentation/column-model.js?v=20260919-v2.0.13&pv2=f0caccb1-local1&audit=20260926-smooth-1", "CrmProjectsColumnsV2"],
        ["js/crm/projects/presentation/table-layout.js?v=20260919-v2.0.13&pv2=f0caccb1-local1&audit=20260926-smooth-1", "CrmProjectsTableLayoutV2"],
        ["js/crm/projects/presentation/row-layout.js?v=20260919-v2.0.13&pv2=f0caccb1-local1&audit=20260926-smooth-1", "CrmProjectsRowLayoutV2"],
        ["js/crm/projects/presentation/contextual-create.js?v=20260919-v2.0.13&pv2=f0caccb1-local1&audit=20260926-smooth-1", "CrmProjectsContextualCreate"],
        ["js/crm/projects/board.js?v=20260919-v2.0.13&phase=10&pv2=f0caccb1-local1&audit=20260926-smooth-1", "CrmProjectsBoard"],
        ["js/crm/projects/workspace.js?v=20260919-v2.0.13&pv2=f0caccb1-local1&audit=20260926-smooth-1", "CrmProjectsWorkspace"],
        ["js/crm/projects/presentation/field-feedback.js?v=20260919-v2.0.13&pv2=f0caccb1-local1&audit=20260926-smooth-1", "CrmProjectsFieldFeedbackV2"],
        ["js/crm/projects/presentation/ui-preferences.js?v=20260919-v2.0.13&pv2=f0caccb1-local1&audit=20260926-smooth-1", "CrmProjectsPreferencesV2"],
        ["js/crm/projects/presentation/shell.js?v=20260919-v2.0.13&pv2=f0caccb1-local1&audit=20260926-smooth-1", "CrmProjectsShellV2"],
        ["js/crm/projects/presentation/detail-surface.js?v=20260919-v2.0.13&pv2=f0caccb1-local1&audit=20260926-smooth-1", "CrmProjectsDetailSurfaceV2"],
        ["js/crm/projects/presentation/entry.js?v=20260919-v2.0.13&pv2=f0caccb1-local1&audit=20260926-smooth-1", "CrmProjectsPresentationV2"],
        ["js/crm/projects/ui-scale.js?v=20260919-v2.0.13&pv2=f0caccb1-local1&audit=20260926-smooth-1", "CrmProjectsUiScale"]
    ];
    const loaded = new Set(), preloads = new Map();
    let pending = null, restartError = null;
    function preload() {
        for (const [src] of scripts) {
            if (loaded.has(src) || preloads.has(src)) continue;
            const link = scope.document.createElement('link');
            link.rel = 'preload'; link.as = 'script'; link.href = src;
            preloads.set(src, link);
            scope.document.head.appendChild(link);
        }
    }
    function load(src, name) {
        if (loaded.has(src)) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const script = scope.document.createElement('script');
            let evaluationError = null, settled = false;
            const requireRestart = error => {
                error.reloadRequired = true;
                restartError = error;
                return error;
            };
            const onError = event => {
                if (event.filename && new URL(event.filename, scope.document.baseURI).href === new URL(src, scope.document.baseURI).href) evaluationError = event.error || new Error(event.message);
            };
            const finish = error => {
                if (settled) return;
                settled = true;
                scope.clearTimeout(timer);
                scope.removeEventListener('error', onError);
                script.onload = script.onerror = null;
                if (error) {
                    script.remove(); preloads.get(src)?.remove(); preloads.delete(src);
                    reject(error);
                } else { loaded.add(src); resolve(); }
            };
            scope.addEventListener('error', onError);
            script.async = false; script.src = src;
            // Removing a timed-out script cannot guarantee that it will never
            // execute later. A document restart is the safe retry in that case.
            const timer = scope.setTimeout(() => finish(requireRestart(new Error('Projects took too long to load. Reload to retry.'))), 20000);
            script.onload = () => finish(evaluationError ? requireRestart(evaluationError) : (!scope[name] ? requireRestart(new Error('Projects module did not register: ' + name)) : null));
            script.onerror = () => finish(new Error('Could not load Projects. Please retry.'));
            scope.document.head.appendChild(script);
        });
    }
    function ensure() {
        if (restartError) return Promise.reject(restartError);
        if (pending) return pending;
        preload();
        pending = (async () => {
            for (const [src, name] of scripts) await load(src, name);
            for (const [, name] of scripts) if (!scope[name]) throw new Error('Missing Projects module: ' + name);
        })().finally(() => { pending = null; });
        return pending;
    }
    scope.CrmProjectsLoader = Object.freeze({ ensure, preload });
})(typeof window !== 'undefined' ? window : globalThis);
