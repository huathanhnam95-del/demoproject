window.CrmBelAssistant = Object.freeze({
    createController(deps = {}) {
        if (!window.CrmDataInputWorkspace || typeof deps.request !== 'function') {
            throw new Error('CRM data input did not load. Reload the page.');
        }
        let controller = null, disposed = false, initialized = false, owner = null;
        const launcher = deps.elements?.belChatLauncher;
        return {
            async init() {
                if (initialized || disposed || !launcher) return;
                initialized = true; owner = deps.getUid?.();
                launcher.disabled = true;
                launcher.title = 'Checking CRM data input availability…';
                try {
                    const capability = await deps.request('/api/admin/data-input/capabilities', { method: 'GET' });
                    if (disposed || !owner || deps.getUid?.() !== owner) return;
                    if (capability.drafts !== true) { launcher.hidden = true; launcher.title = 'CRM data input is not enabled. Use the CRM record forms.'; return; }
                    controller = window.CrmDataInputWorkspace.createController({ ...deps, initialCapabilities: capability });
                    controller.init(); launcher.hidden = false; launcher.disabled = false; launcher.title = '';
                } catch {
                    if (!disposed) { launcher.disabled = true; launcher.title = 'CRM data input is unavailable. Reload to check again.'; }
                }
            },
            onRouteChange(...args) {
                if (deps.getUid?.() !== owner) {
                    controller?.onRouteChange?.(...args); controller?.dispose?.(); controller = null;
                    if (launcher) launcher.disabled = true;
                    if (deps.elements?.belChatDrawer) { deps.elements.belChatDrawer.style.display = 'none'; deps.elements.belChatDrawer.setAttribute('aria-hidden', 'true'); }
                    return;
                }
                controller?.onRouteChange?.(...args);
            },
            dispose() { disposed = true; controller?.dispose?.(); controller = null; }
        };
    }
});
