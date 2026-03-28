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

  registerLocalOnlyRoutes(router, {
    db: fakeDb,
    admin: fakeAdmin,
    authMiddleware: (req, res, next) => next && next(),
    sendSuccess,
    sendError,
    getStorageBucket: async () => defaultBucket,
    serverTimestamp: () => 'server-timestamp'
  });

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

(async () => {
  await verifyAudioUrlRouteUsesPersistedBucketName();
  verifyResultPageRenderMarkers();
  console.log('entrance test review regressions passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
