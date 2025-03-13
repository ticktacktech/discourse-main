import { isBoundary } from "discourse/static/prosemirror/lib/markdown-it";

/** @type {RichEditorExtension} */
const extension = {
  nodeSpec: {
    hashtag: {
      attrs: { name: {} },
      inline: true,
      group: "inline",
      content: "text*",
      atom: true,
      draggable: true,
      selectable: false,
      parseDOM: [
        {
          tag: "a.hashtag-cooked",
          preserveWhitespace: "full",
          getAttrs: (dom) => {
            return { name: dom.getAttribute("data-name") };
          },
        },
      ],
      toDOM: (node) => {
        return [
          "a",
          { class: "hashtag-cooked", "data-name": node.attrs.name },
          `#${node.attrs.name}`,
        ];
      },
    },
  },

  inputRules: [
    {
      match: /(^|\W)(#[\u00C0-\u1FFF\u2C00-\uD7FF\w:-]{1,101})\s$/,
      handler: (state, match, start, end) => {
        const hashtagStart = start + match[1].length;
        const name = match[2].slice(1);
        return (
          state.selection.$from.nodeBefore?.type !==
            state.schema.nodes.hashtag &&
          state.tr.replaceWith(hashtagStart, end, [
            state.schema.nodes.hashtag.create({ name }),
            state.schema.text(" "),
          ])
        );
      },
      options: { undoable: false },
    },
  ],

  parse: {
    span_open(state, token, tokens, i) {
      if (token.attrGet("class") === "hashtag-raw") {
        state.openNode(state.schema.nodes.hashtag, {
          name: tokens[i + 1].content.slice(1),
        });
        return true;
      }
    },
    span_close(state) {
      if (state.top().type.name === "hashtag") {
        state.closeNode();
        return true;
      }
    },
  },

  serializeNode: {
    hashtag(state, node, parent, index) {
      if (!isBoundary(state.out, state.out.length - 1)) {
        state.write(" ");
      }

      state.write(`#${node.attrs.name}`);

      const nextSibling =
        parent.childCount > index + 1 ? parent.child(index + 1) : null;
      if (nextSibling?.isText && !isBoundary(nextSibling.text, 0)) {
        state.write(" ");
      }
    },
  },
};

export default extension;
