(function (globalScope) {
    'use strict';
    function createController(deps) {
        // Wave 1 retains the existing workspace renderer. Later waves replace
        // presentation incrementally here, without mounting a second workspace.
        const workspace = deps.createWorkspace({ presentationV2: deps.config?.projectsV2 === true });
        if (deps.config?.projectsV2 !== true) return workspace;
        const feedback = globalScope.CrmProjectsFieldFeedbackV2.createStore();
        const shell = globalScope.CrmProjectsShellV2?.createController(deps);
        const preferences = globalScope.CrmProjectsPreferencesV2?.createController(deps);
        let initialized = false, disposed = false;
        return {
            ...workspace,
            feedback,
            preferences,
            setSelection(value) { shell?.setSelection(value); workspace?.setSelection?.(value); },
            closeForNavigation() { shell?.closeForNavigation(); workspace?.closeForNavigation?.(); },
            onFieldSaveEvent: event => feedback.accept(event),
            setFieldSaveScope: scope => feedback.setScope(scope),
            init() {
                if (initialized || disposed) return;
                initialized = true;
                deps.panel?.classList.add('projects-v2');
                deps.panel?.setAttribute?.('data-projects-ui', 'v2');
                shell?.init();
                workspace?.init?.();
                preferences?.init();
            },
            dispose() {
                if (disposed) return;
                disposed = true;
                feedback.dispose();
                preferences?.dispose();
                deps.onDisposePresentation?.();
                workspace?.dispose?.();
                shell?.dispose();
                deps.panel?.classList.remove('projects-v2');
                deps.panel?.removeAttribute?.('data-projects-ui');
            }
        };
    }
    globalScope.CrmProjectsPresentationV2 = { createController };
})(typeof window !== 'undefined' ? window : globalThis);
