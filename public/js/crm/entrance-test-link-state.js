window.CrmEntranceTests = (function () {
  const ACTIVE_STATUSES = new Set(['created', 'started']);
  const DEFAULT_NOTE = 'Create a test to generate a single-use learner link you can send.';
  const READY_NOTE = 'Latest single-use learner link is ready to send. It will stop working after submission.';
  const USED_NOTE = 'This learner link has already been used. Create a new test to generate a fresh link.';

  function toText(value) {
    return String(value || '').trim();
  }

  function escapeHtml(value) {
    return toText(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isActiveStatus(status) {
    return ACTIVE_STATUSES.has(toText(status).toLowerCase());
  }

  function resolveTestLink(test, createdTestLinks = new Map()) {
    if (!isActiveStatus(test?.status)) return '';

    const apiLink = toText(test?.testLink);
    if (apiLink) return apiLink;

    const testId = toText(test?.testId);
    if (!testId || typeof createdTestLinks?.get !== 'function') return '';
    return toText(createdTestLinks.get(testId));
  }

  function buildViewModel(tests, createdTestLinks = new Map()) {
    const normalized = Array.isArray(tests)
      ? tests.map((test) => {
          const testId = toText(test?.testId);
          const status = toText(test?.status || 'created').toLowerCase();
          const createdAt = test?.createdAt || null;
          const startedAt = test?.startedAt || null;
          const submittedAt = test?.submittedAt || null;
          const resultLink = toText(test?.resultLink);

          return {
            ...test,
            testId,
            status,
            createdAt,
            startedAt,
            submittedAt,
            testLink: resolveTestLink({ ...test, testId, status }, createdTestLinks),
            resultLink
          };
        })
      : [];

    const latestActiveTest = normalized.find((test) => isActiveStatus(test.status) && toText(test.testLink)) || null;
    return { tests: normalized, latestActiveTest };
  }

  function resolveNote(latestActiveTest, hasAnyTests) {
    if (latestActiveTest && toText(latestActiveTest.testLink)) return READY_NOTE;
    if (hasAnyTests) return USED_NOTE;
    return DEFAULT_NOTE;
  }

  function applyControls(elements, latestActiveTest = null, { hasAnyTests = false } = {}) {
    const activeLink = toText(latestActiveTest?.testLink);

    if (elements.entranceTestLinkInput) {
      elements.entranceTestLinkInput.value = activeLink;
    }
    if (elements.btnCopyEntranceTestLink) {
      elements.btnCopyEntranceTestLink.disabled = !activeLink;
    }
    if (elements.btnOpenEntranceTestLink) {
      elements.btnOpenEntranceTestLink.disabled = !activeLink;
    }
    if (elements.entranceTestLinkNote) {
      elements.entranceTestLinkNote.textContent = resolveNote(latestActiveTest, hasAnyTests);
    }

    return {
      activeLink,
      note: resolveNote(latestActiveTest, hasAnyTests)
    };
  }

  function formatCellDate(formatDateTime, value) {
    if (typeof formatDateTime === 'function') {
      return formatDateTime(value);
    }
    return '';
  }

  function buildRowsHtml(tests, { formatDateTime } = {}) {
    return (Array.isArray(tests) ? tests : []).map((test) => {
      const status = toText(test?.status || 'created').toLowerCase();
      const statusLabel = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Created';
      const testLink = toText(test?.testLink);
      const resultLink = toText(test?.resultLink);

      return `
        <tr>
          <td><span class="crm-test-status ${escapeHtml(status)}">${escapeHtml(statusLabel)}</span></td>
          <td>${escapeHtml(formatCellDate(formatDateTime, test?.createdAt))}</td>
          <td>${escapeHtml(formatCellDate(formatDateTime, test?.startedAt))}</td>
          <td>${escapeHtml(formatCellDate(formatDateTime, test?.submittedAt))}</td>
          <td>${testLink ? `<a class="crm-test-link" href="${escapeHtml(testLink)}" target="_blank" rel="noopener">Open</a>` : 'Unavailable'}</td>
          <td>${resultLink ? `<a class="crm-test-link" href="${escapeHtml(resultLink)}" target="_blank" rel="noopener">View</a>` : 'Unavailable'}</td>
        </tr>
      `;
    }).join('');
  }

  return {
    ACTIVE_STATUSES,
    DEFAULT_NOTE,
    READY_NOTE,
    USED_NOTE,
    buildViewModel,
    buildRowsHtml,
    applyControls,
    resolveNote
  };
})();
