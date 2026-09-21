/* eslint-disable no-console */
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

function createMockDocument() {
  class MockNode {
    constructor(type, ownerDocument) {
      this.nodeType = type;
      this.ownerDocument = ownerDocument;
      this.children = [];
      this.attributes = {};
      this.dataset = {};
      this.style = {};
      this.className = '';
      this._textContent = '';
      this.parentNode = null;
    }

    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    }

    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }

    getAttribute(name) {
      return this.attributes[name];
    }

    set innerHTML(value) {
      this.children = [];
      this._innerHTML = value ? String(value) : '';
      this._textContent = value ? String(value).replace(/<[^>]+>/g, '') : '';
    }

    get innerHTML() {
      return this._innerHTML !== undefined ? this._innerHTML : this._textContent;
    }

    set textContent(value) {
      this.children = [];
      this._innerHTML = undefined;
      this._textContent = value == null ? '' : String(value);
    }

    get textContent() {
      if (this.children.length === 0) {
        return this._textContent;
      }
      return this.children.map((child) => child.textContent).join('');
    }
  }

  class MockTextNode extends MockNode {
    constructor(text, ownerDocument) {
      super('text', ownerDocument);
      this._textContent = text;
    }
  }

  return {
    createElement(tagName) {
      const node = new MockNode(tagName.toLowerCase(), this);
      node.tagName = tagName.toUpperCase();
      return node;
    },
    createTextNode(text) {
      return new MockTextNode(text, this);
    }
  };
}

async function loadSharedModules() {
  await import(pathToFileURL(path.join(__dirname, '../public/js/read-aloud-prompt-grammar.js')).href);
  await import(pathToFileURL(path.join(__dirname, '../public/js/read-aloud-stress-rhythm.js')).href);
  await import(pathToFileURL(path.join(__dirname, '../public/js/read-aloud-prompt-renderer.js')).href);
  return {
    grammar: globalThis.ReadAloudPromptGrammar,
    renderer: globalThis.ReadAloudPromptRenderer
  };
}

(async () => {
  const { grammar, renderer } = await loadSharedModules();
  const previousDocument = global.document;
  global.document = createMockDocument();

  const visibleContainer = global.document.createElement('p');
  const accessibleContainer = global.document.createElement('p');

  const result = renderer.renderPrompt({
    visibleContainer,
    accessibleContainer,
    plainText: 'The amount of sunlight that Earth reflects back into space has decreased.',
    chunkedText: 'The amount of sunlight / that Earth reflects back into space // has decreased.',
    chunkingEnabled: true,
    grammar
  });

  assert.strictEqual(result.chunkingAvailable, true, 'valid chunked text should be marked available');
  assert.strictEqual(accessibleContainer.textContent, 'The amount of sunlight that Earth reflects back into space has decreased.', 'accessible container should keep the canonical plain prompt');
  assert.strictEqual(visibleContainer.getAttribute('aria-hidden'), 'true', 'visible container should be hidden from assistive tech when a clean prompt node exists');
  assert.ok(visibleContainer.textContent.includes(' / '), 'visible prompt should include short chunk markers when chunking is enabled');
  assert.ok(visibleContainer.textContent.includes(' // '), 'visible prompt should include long chunk markers when chunking is enabled');
  assert.ok(result.wordMap.size > 0, 'renderer should expose stable word spans for linking geometry');
  assert.ok(result.blockedBoundarySet.has('3:4'), 'renderer should expose blocked boundaries derived from chunk markers');
  assert.ok(result.blockedBoundarySet.has('9:10'), 'renderer should expose all chunk-blocked boundaries');

  const invalidResult = renderer.renderPrompt({
    visibleContainer,
    accessibleContainer,
    plainText: 'The data is useful.',
    chunkedText: 'The data / // is useful.',
    chunkingEnabled: true,
    grammar
  });
  assert.strictEqual(invalidResult.chunkingAvailable, false, 'invalid chunked text should be rejected');
  assert.ok(!visibleContainer.textContent.includes(' / '), 'invalid chunked text should fall back to plain visible prompt rendering');

  // Test stressEnabled: true with chunking simultaneously
  const stressResult = renderer.renderPrompt({
    visibleContainer,
    accessibleContainer,
    plainText: "It's super quick and easy to make.",
    chunkedText: "It's super quick / and easy to make.",
    chunkingEnabled: true,
    stressEnabled: true,
    grammar
  });
  const word1 = stressResult.wordMap.get(1); // 'super'
  assert.ok(word1.innerHTML.includes('<span class="ra-stress-peak">su</span>per'), 'word span should contain syllable stress peak');
  assert.ok(visibleContainer.textContent.includes(' / '), 'chunking and stress should compose simultaneously');
  assert.strictEqual(accessibleContainer.textContent, "It's super quick and easy to make.", 'accessible plain text should stay clean');

  global.document = previousDocument;
  console.log('read-aloud prompt renderer tests passed');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
