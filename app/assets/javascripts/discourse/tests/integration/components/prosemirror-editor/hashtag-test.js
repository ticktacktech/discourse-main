import { module, test } from "qunit";
import { setupRenderingTest } from "discourse/tests/helpers/component-test";
import { testMarkdown } from "discourse/tests/helpers/rich-editor-helper";

module(
  "Integration | Component | prosemirror-editor - hashtag extension",
  function (hooks) {
    setupRenderingTest(hooks);

    const testCases = {
      hashtag: [
        [
          "#hello",
          '<p><a class="hashtag-cooked" data-name="hello" contenteditable="false" draggable="true">#hello</a></p>',
          "#hello",
        ],
        [
          "Hello #category",
          '<p>Hello <a class="hashtag-cooked" data-name="category" contenteditable="false" draggable="true">#category</a></p>',
          "Hello #category",
        ],
      ],
    };

    Object.entries(testCases).forEach(([name, tests]) => {
      tests.forEach(([markdown, expectedHtml, expectedMarkdown]) => {
        test(name, async function (assert) {
          this.siteSettings.rich_editor = true;

          await testMarkdown(assert, markdown, expectedHtml, expectedMarkdown);
        });
      });
    });
  }
);
