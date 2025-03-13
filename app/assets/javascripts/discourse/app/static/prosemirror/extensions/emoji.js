import { buildEmojiUrl, emojiExists, isCustomEmoji } from "pretty-text/emoji";
import { translations } from "pretty-text/emoji/data";
import escapeRegExp from "discourse/lib/escape-regexp";
import { emojiOptions } from "discourse/lib/text";
import { isBoundary } from "discourse/static/prosemirror/lib/markdown-it";

/** @type {RichEditorExtension} */
const extension = {
  nodeSpec: {
    emoji: {
      attrs: { code: {} },
      inline: true,
      group: "inline",
      draggable: true,
      selectable: false,
      parseDOM: [
        {
          tag: "img.emoji",
          getAttrs: (dom) => {
            return { code: dom.getAttribute("alt").replace(/:/g, "") };
          },
          priority: 60,
        },
      ],
      toDOM: (node) => {
        const opts = emojiOptions();
        const code = node.attrs.code.toLowerCase();
        const title = `:${code}:`;
        const src = buildEmojiUrl(code, opts);

        return [
          "img",
          {
            class: isCustomEmoji(code, opts) ? "emoji emoji-custom" : "emoji",
            alt: title,
            title,
            src,
          },
        ];
      },
    },
  },

  inputRules: [
    {
      match: /(^|\W):([^:]+):$/,
      handler: (state, match, start, end) => {
        if (emojiExists(match[2])) {
          const emojiStart = start + match[1].length;
          return state.tr.replaceWith(
            emojiStart,
            end,
            state.schema.nodes.emoji.create({ code: match[2] })
          );
        }
      },
      options: { undoable: false },
    },
    {
      match: new RegExp(
        "(^|\\W)(" +
          Object.keys(translations).map(escapeRegExp).join("|") +
          ") $"
      ),
      handler: (state, match, start, end) => {
        const emojiStart = start + match[1].length;
        return state.tr
          .replaceWith(
            emojiStart,
            end,
            state.schema.nodes.emoji.create({ code: translations[match[2]] })
          )
          .insertText(" ");
      },
    },
  ],

  parse: {
    emoji: {
      node: "emoji",
      getAttrs: (token) => ({
        code: token.attrGet("alt").slice(1, -1),
      }),
    },
  },

  serializeNode: {
    emoji(state, node) {
      if (!isBoundary(state.out, state.out.length - 1)) {
        state.write(" ");
      }

      state.write(`:${node.attrs.code}:`);
    },
  },
};

export default extension;
