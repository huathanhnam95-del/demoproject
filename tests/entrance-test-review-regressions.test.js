/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { registerLocalOnlyRoutes } = require(path.join(process.cwd(), 'src/routes/admin.js'));

function createRouter() {
  const routes = [];
  return {
    routes,
    get(routePath, ...handlers) {
      routes.push({ method: 'GET', path: routePath, handlers });
    },
    post(routePath, ...handlers) {
      routes.push({ method: 'POST', path: routePath, handlers });
    },
    use(routePath, ...handlers) {
      routes.push({ method: 'USE', path: routePath, handlers });
    }
  };
}

function sendSuccess(res, data, message = 'ok') {
  res.statusCode = 200;
  res.body = { success: true, message, ...data };
  return res;
}

function sendError(res, statusCode, error, message) {
  res.statusCode = statusCode;
  res.body = { success: false, error, message };
  return res;
}

async function verifyAudioUrlRouteUsesPersistedBucketName() {
  const router = createRouter();
  const defaultBucket = {
    file(storagePath) {
      return {
        async getSignedUrl() {
          return [`https://default-bucket.example/${storagePath}`];
        }
      };
    }
  };

  const bucketCalls = [];
  const fakeAdmin = {
    storage() {
      return {
        bucket(bucketName) {
          bucketCalls.push(bucketName);
          return {
            file(storagePath) {
              return {
                async getSignedUrl() {
                  return [`https://signed.example/${bucketName}/${storagePath}`];
                }
              };
            }
          };
        }
      };
    },
    firestore: {
      FieldValue: {
        serverTimestamp() {
          return 'server-timestamp';
        }
      }
    }
  };

  const fakeDb = {
    collection(name) {
      if (name !== 'entranceTests') {
        throw new Error(`Unexpected collection lookup: ${name}`);
      }
      return {
        doc() {
          return {
            async get() {
              return {
                exists: true,
                data() {
                  return {
                    speaking: {
                      q1: {
                        audio: {
                          storagePath: 'audio/q1.webm',
                          bucketName: 'persisted-audio-bucket'
                        }
                      }
                    }
                  };
                }
              };
            }
          };
        }
      };
    }
  };

  const previousFlag = process.env.ENABLE_LEGACY_DUPLICATE_ENTRANCE_TEST_ROUTES;
  process.env.ENABLE_LEGACY_DUPLICATE_ENTRANCE_TEST_ROUTES = '1';
  try {
    registerLocalOnlyRoutes(router, {
      db: fakeDb,
      admin: fakeAdmin,
      authMiddleware: (req, res, next) => next && next(),
      sendSuccess,
      sendError,
      getStorageBucket: async () => defaultBucket,
      serverTimestamp: () => 'server-timestamp'
    });
  } finally {
    if (typeof previousFlag === 'string') {
      process.env.ENABLE_LEGACY_DUPLICATE_ENTRANCE_TEST_ROUTES = previousFlag;
    } else {
      delete process.env.ENABLE_LEGACY_DUPLICATE_ENTRANCE_TEST_ROUTES;
    }
  }

  const route = router.routes.find((entry) => entry.method === 'GET' && entry.path === '/entrance-tests/:testId/speaking/:questionId/audio-url');
  assert(route, 'Audio URL admin route should be registered.');

  const res = {};
  await route.handlers[route.handlers.length - 1]({
    params: { testId: 'test-1', questionId: 'q1' }
  }, res);

  assert.strictEqual(res.statusCode, 200, 'Audio URL route should succeed for a stored speaking response.');
  assert.strictEqual(bucketCalls[0], 'persisted-audio-bucket', 'Audio URL route should sign from the persisted bucketName.');
  assert.strictEqual(
    res.body.url,
    'https://signed.example/persisted-audio-bucket/audio/q1.webm',
    'Audio URL route should return the signed URL from the persisted bucket.'
  );
}

function verifyResultPageRenderMarkers() {
  const resultUiSource = fs.readFileSync(
    path.join(process.cwd(), 'public/crm-entrance-test-result.js'),
    'utf8'
  );

  assert.match(
    resultUiSource,
    /crm-result-audio/,
    'Result page should render a concrete audio marker for speaking playback.'
  );

  assert.match(
    resultUiSource,
    /\/api\/admin\/entrance-tests\/\$\{encodeURIComponent\(testId\)\}\/speaking\/\$\{encodeURIComponent\(questionId\)\}\/audio-url/,
    'Result page should fetch speaking audio from the admin audio-url route.'
  );
}

function verifyPdfExportUsesDedicatedShell() {
  const resultUiSource = fs.readFileSync(
    path.join(process.cwd(), 'public/crm-entrance-test-result.js'),
    'utf8'
  );
  const resultCssSource = fs.readFileSync(
    path.join(process.cwd(), 'public/crm-entrance-test-result.css'),
    'utf8'
  );

  assert.match(
    resultUiSource,
    /crm-result-pdf-shell/,
    'PDF export should build a dedicated shell instead of exporting the live admin container.'
  );

  assert.match(
    resultUiSource,
    /cloneNode\(true\)/,
    'PDF export should clone the rendered result tree before capture.'
  );

  assert.match(
    resultUiSource,
    /page\.getBoundingClientRect\(\)\.width/,
    'PDF export should measure each printable page directly before rendering it.'
  );

  assert.match(
    resultUiSource,
    /page\.getBoundingClientRect\(\)\.height/,
    'PDF export should measure each printable page directly before rendering it.'
  );

  assert.ok(
    /toPdf\(\)\.get\('pdf'\)/.test(resultUiSource),
    'PDF export should render the first page to a PDF and retrieve the jsPDF instance.'
  );

  assert.match(
    resultUiSource,
    /toCanvas\(\)\.get\('canvas'\)/,
    'PDF export should render later pages to canvases before composing them into the PDF.'
  );

  assert.match(
    resultUiSource,
    /pdf\.addPage\(\)/,
    'PDF export should add a new jsPDF page for each rendered page beyond the first.'
  );

  assert.match(
    resultUiSource,
    /pdf\.addImage\(/,
    'PDF export should draw each rendered page into the jsPDF document.'
  );

  assert.ok(
    !/from\(exportShell\)\.save\(\)/.test(resultUiSource),
    'PDF export should not save the whole export shell as a single html2pdf job.'
  );

  assert.ok(
    !/windowWidth:\s*captureWidth/.test(resultUiSource),
    'PDF export should not force html2canvas windowWidth to the export shell width because that shrinks wide-screen captures.'
  );

  assert.ok(
    !/pagebreak:\s*\{\s*mode:\s*\[['"]css['"]/.test(resultUiSource),
    'Per-page rendering should not depend on html2pdf page-break mode.'
  );

  assert.match(
    resultUiSource,
    /crm-result-pdf-page/,
    'PDF export should build dedicated PDF page wrappers instead of one continuously sliced sheet.'
  );

  assert.ok(
    !/crm-pdf-exporting/.test(resultUiSource),
    'PDF export should not keep the old live-shell export class in the implementation.'
  );

  assert.ok(
    !/crm-result-pdf-page-break/.test(resultUiSource),
    'PDF export should not rely on the old page-break marker flow once page wrappers are in place.'
  );

  assert.ok(
    !/mode:\s*\[\s*['"]css['"]\s*,\s*['"]legacy['"]\s*\]/.test(resultUiSource),
    'PDF export should not mix CSS and legacy html2pdf page-break modes.'
  );

  assert.match(
    resultCssSource,
    /\.crm-result-pdf-shell\s*\{[\s\S]*?position:\s*relative/,
    'PDF CSS should namespace the export shell styles.'
  );

  assert.ok(
    !/crm-admin\.crm-pdf-exporting/.test(resultCssSource),
    'PDF CSS should not force the live admin shell to a fixed export width.'
  );

  assert.ok(
    !/left:\s*-20000px/.test(resultCssSource),
    'PDF CSS should not shove the export shell offscreen.'
  );

  assert.ok(
    !/position:\s*fixed/.test(resultCssSource.match(/\.crm-result-pdf-shell\s*\{[\s\S]*?\}/)?.[0] || ''),
    'PDF CSS should keep the dedicated export shell in normal flow.'
  );

  assert.ok(
    !/\.crm-result-pdf-shell\s+\.crm-result-details,\s*\.crm-result-pdf-shell\s+\.crm-result-question\s*\{[\s\S]*?break-inside:\s*avoid/.test(resultCssSource),
    'PDF CSS should not make entire result sections unbreakable.'
  );

  assert.match(
    resultCssSource,
    /\.crm-result-pdf-page\s*\{[\s\S]*?page-break-after:\s*always/,
    'PDF CSS should define dedicated page wrappers that map to whole PDF pages.'
  );

  assert.ok(
    !/nth-child\(2\)/.test(resultCssSource),
    'PDF CSS should not hide the test card by positional selector.'
  );
}

function verifyLocalAdminRouterPassesStorageResolver() {
  const adminRouteSource = fs.readFileSync(
    path.join(process.cwd(), 'src/routes/admin.js'),
    'utf8'
  );

  assert.match(
    adminRouteSource,
    /createCrmRouter\(\{[\s\S]*?\bgetStorageBucket\b[\s\S]*?\}\)/,
    'Local CRM admin router should pass getStorageBucket into the shared route factory.'
  );
}

(async () => {
  await verifyAudioUrlRouteUsesPersistedBucketName();
  verifyResultPageRenderMarkers();
  verifyPdfExportUsesDedicatedShell();
  verifyLocalAdminRouterPassesStorageResolver();
  console.log('entrance test review regressions passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
