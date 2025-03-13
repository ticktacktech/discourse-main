// @ts-check
import { setOwner } from "@ember/owner";
import { next } from "@ember/runloop";
import $ from "jquery";
import { lift, setBlockType, toggleMark, wrapIn } from "prosemirror-commands";
import { liftListItem, sinkListItem } from "prosemirror-schema-list";
import { TextSelection } from "prosemirror-state";
import { bind } from "discourse/lib/decorators";
import { i18n } from "discourse-i18n";

/**
 * @typedef {import("discourse/lib/composer/text-manipulation").TextManipulation} TextManipulation
 * @typedef {import("discourse/lib/composer/text-manipulation").AutocompleteHandler} AutocompleteHandler
 * @typedef {import("discourse/lib/composer/text-manipulation").PlaceholderHandler} PlaceholderHandler
 */

/** @implements {TextManipulation} */
export default class ProsemirrorTextManipulation {
  allowPreview = false;

  /** @type {import("prosemirror-model").Schema} */
  schema;
  /** @type {import("prosemirror-view").EditorView} */
  view;
  /** @type {PlaceholderHandler} */
  placeholder;
  /** @type {AutocompleteHandler} */
  autocompleteHandler;
  convertFromMarkdown;
  convertToMarkdown;

  constructor(owner, { schema, view, convertFromMarkdown, convertToMarkdown }) {
    setOwner(this, owner);
    this.schema = schema;
    this.view = view;
    this.convertFromMarkdown = convertFromMarkdown;
    this.convertToMarkdown = convertToMarkdown;

    this.placeholder = new ProsemirrorPlaceholderHandler({
      schema,
      view,
      convertFromMarkdown,
    });
    this.autocompleteHandler = new ProsemirrorAutocompleteHandler({
      schema,
      view,
      convertFromMarkdown,
    });
  }

  getSelected() {
    const start = this.view.state.selection.from;
    const end = this.view.state.selection.to;
    const value = this.view.state.doc.textBetween(start, end, " ", " ");
    return {
      start,
      end,
      pre: "",
      value,
      post: "",
    };
  }

  focus() {
    this.view.focus();
  }

  blurAndFocus() {
    this.focus();
  }

  putCursorAtEnd() {
    this.focus();
    next(() => (this.view.dom.scrollTop = this.view.dom.scrollHeight));
  }

  autocomplete(options) {
    // @ts-ignore
    $(this.view.dom).autocomplete(
      options instanceof Object
        ? { textHandler: this.autocompleteHandler, ...options }
        : options
    );
  }

  applySurroundSelection(head, tail, exampleKey) {
    this.applySurround(this.getSelected(), head, tail, exampleKey);
  }

  applySurround(sel, head, tail, exampleKey) {
    const applySurroundMap = {
      italic_text: this.schema.marks.em,
      bold_text: this.schema.marks.strong,
      code_title: this.schema.marks.code,
    };

    if (applySurroundMap[exampleKey]) {
      toggleMark(applySurroundMap[exampleKey])(
        this.view.state,
        this.view.dispatch
      );

      return;
    }

    const text = head + i18n(`composer.${exampleKey}`) + tail;
    const doc = this.convertFromMarkdown(text);

    this.view.dispatch(
      this.view.state.tr.replaceWith(sel.start, sel.end, doc.content.firstChild)
    );
  }

  addText(sel, text) {
    const doc = this.convertFromMarkdown(text);

    // assumes it returns a single block node
    const content =
      doc.content.firstChild.type.name === "paragraph"
        ? doc.content.firstChild.content
        : doc.content.firstChild;

    this.view.dispatch(
      this.view.state.tr.replaceWith(sel.start, sel.end, content)
    );

    this.focus();
  }

  insertBlock(block) {
    const doc = this.convertFromMarkdown(block);
    const node = doc.content.firstChild;

    const tr = this.view.state.tr.replaceSelectionWith(node);
    if (!tr.selection.$from.nodeAfter) {
      tr.setSelection(new TextSelection(tr.doc.resolve(tr.selection.from + 1)));
    }
    this.view.dispatch(tr);

    this.focus();
  }

  applyList(_selection, head, exampleKey) {
    let command;

    const isInside = (type) => {
      const $from = this.view.state.selection.$from;
      for (let depth = $from.depth; depth > 0; depth--) {
        const parent = $from.node(depth);
        if (parent.type === type) {
          return true;
        }
      }
      return false;
    };

    if (exampleKey === "list_item") {
      const nodeType =
        head === "* "
          ? this.schema.nodes.bullet_list
          : this.schema.nodes.ordered_list;

      command = isInside(this.schema.nodes.list_item) ? lift : wrapIn(nodeType);
    } else if (exampleKey === "blockquote_text") {
      command = isInside(this.schema.nodes.blockquote)
        ? lift
        : wrapIn(this.schema.nodes.blockquote);
    } else {
      throw new Error("Unknown exampleKey");
    }

    command?.(this.view.state, this.view.dispatch);
  }

  formatCode() {
    let command;

    const selection = this.view.state.selection;

    if (selection.$from.parent.type === this.schema.nodes.code_block) {
      command = setBlockType(this.schema.nodes.paragraph);
    } else if (
      selection.$from.pos !== selection.$to.pos &&
      selection.$from.parent === selection.$to.parent
    ) {
      command = toggleMark(this.schema.marks.code);
    } else {
      command = setBlockType(this.schema.nodes.code_block);
    }

    command?.(this.view.state, this.view.dispatch);
  }

  @bind
  emojiSelected(code) {
    this.view.dispatch(
      this.view.state.tr
        .replaceSelectionWith(this.schema.nodes.emoji.create({ code }))
        .insertText(" ")
    );
  }

  @bind
  paste() {
    // Intentionally no-op
    // Pasting markdown is being handled by the markdown-paste extension
    // Pasting a url on top of a text is being handled by the link extension
  }

  selectText(from, length, opts) {
    const tr = this.view.state.tr.setSelection(
      new TextSelection(
        this.view.state.doc.resolve(from),
        this.view.state.doc.resolve(from + length)
      )
    );

    if (opts.scroll) {
      tr.scrollIntoView();
    }

    this.view.dispatch(tr);
  }

  @bind
  inCodeBlock() {
    return this.autocompleteHandler.inCodeBlock();
  }

  indentSelection(direction) {
    const { selection } = this.view.state;

    const isInsideListItem =
      selection.$head.depth > 0 &&
      selection.$head.node(-1).type === this.schema.nodes.list_item;

    if (isInsideListItem) {
      const command =
        direction === "right"
          ? sinkListItem(this.schema.nodes.list_item)
          : liftListItem(this.schema.nodes.list_item);
      command(this.view.state, this.view.dispatch);
      return true;
    }
  }

  insertText(text) {
    const doc = this.convertFromMarkdown(text);

    this.view.dispatch(
      this.view.state.tr
        .replaceSelectionWith(doc.content.firstChild)
        .scrollIntoView()
    );

    this.focus();
  }

  replaceText(oldValue, newValue, opts = {}) {
    // Replacing Markdown text is not reliable and should eventually be deprecated

    const markdown = this.convertToMarkdown(this.view.state.doc);

    const regex = opts.regex || new RegExp(oldValue, "g");
    const index = opts.index || 0;
    let matchCount = 0;

    const newMarkdown = markdown.replace(regex, (match) => {
      if (matchCount++ === index) {
        return newValue;
      }
      return match;
    });

    if (markdown === newMarkdown) {
      return;
    }

    const newDoc = this.convertFromMarkdown(newMarkdown);
    if (!newDoc) {
      return;
    }

    const diff = newValue.length - oldValue.length;
    const startOffset = this.view.state.selection.from + diff;
    const endOffset = this.view.state.selection.to + diff;

    const tr = this.view.state.tr.replaceWith(
      0,
      this.view.state.doc.content.size,
      newDoc.content
    );

    if (
      !opts.skipNewSelection &&
      (opts.forceFocus || this.view.dom === document.activeElement)
    ) {
      const adjustedStart = Math.min(startOffset, tr.doc.content.size);
      const adjustedEnd = Math.min(endOffset, tr.doc.content.size);

      tr.setSelection(TextSelection.create(tr.doc, adjustedStart, adjustedEnd));
    }

    this.view.dispatch(tr);
  }

  toggleDirection() {
    this.view.dom.dir = this.view.dom.dir === "rtl" ? "ltr" : "rtl";
  }
}

/** @implements {AutocompleteHandler} */
class ProsemirrorAutocompleteHandler {
  /** @type {import("prosemirror-view").EditorView} */
  view;
  /** @type {import("prosemirror-model").Schema} */
  schema;
  convertFromMarkdown;

  constructor({ schema, view, convertFromMarkdown }) {
    this.schema = schema;
    this.view = view;
    this.convertFromMarkdown = convertFromMarkdown;
  }

  /**
   * The textual value of the selected text block
   * @returns {string}
   */
  getValue() {
    return (
      (this.view.state.selection.$head.nodeBefore?.textContent ?? "") +
        (this.view.state.selection.$head.nodeAfter?.textContent ?? "") || " "
    );
  }

  /**
   * Replaces the term between start-end in the currently selected text block
   *
   * It uses input rules to convert it to a node if possible
   *
   * @param {number} start
   * @param {number} end
   * @param {String} term
   */
  replaceTerm(start, end, term) {
    const node = this.view.state.selection.$head.nodeBefore;
    const from = this.view.state.selection.from - node.nodeSize + start;
    const to = this.view.state.selection.from - node.nodeSize + end + 1;

    const doc = this.convertFromMarkdown(term);

    const tr = this.view.state.tr.replaceWith(
      from,
      to,
      doc.content.firstChild.content
    );
    tr.insertText(" ", tr.selection.from);

    this.view.dispatch(tr);
  }

  /**
   * Gets the textual caret position within the selected text block
   *
   * @returns {number}
   */
  getCaretPosition() {
    const node = this.view.state.selection.$head.nodeBefore;

    if (!node?.isText) {
      return 0;
    }

    return node.nodeSize;
  }

  getCaretCoords(start) {
    const node = this.view.state.selection.$head.nodeBefore;
    const pos = this.view.state.selection.from - node.nodeSize + start;
    const { left, top } = this.view.coordsAtPos(pos);

    const rootRect = this.view.dom.getBoundingClientRect();

    return {
      left: left - rootRect.left,
      top: top - rootRect.top,
    };
  }

  async inCodeBlock() {
    return (
      this.view.state.selection.$from.parent.type ===
      this.schema.nodes.code_block
    );
  }
}

/** @implements {PlaceholderHandler} */
class ProsemirrorPlaceholderHandler {
  view;
  schema;
  convertFromMarkdown;

  constructor({ schema, view, convertFromMarkdown }) {
    this.schema = schema;
    this.view = view;
    this.convertFromMarkdown = convertFromMarkdown;
  }

  insert(file) {
    const isEmptyParagraph =
      this.view.state.selection.$from.parent.type.name === "paragraph" &&
      this.view.state.selection.$from.parent.nodeSize === 2;

    const imageNode = this.schema.nodes.image.create({
      src: URL.createObjectURL(file.data),
      alt: i18n("uploading_filename", { filename: file.name }),
      title: file.id,
      width: 120,
      "data-placeholder": true,
    });

    this.view.dispatch(
      this.view.state.tr.insert(
        this.view.state.selection.from,
        isEmptyParagraph
          ? imageNode
          : this.schema.nodes.paragraph.create(null, imageNode)
      )
    );
  }

  progress() {}
  progressComplete() {}

  cancelAll() {
    this.view.state.doc.descendants((node, pos) => {
      if (
        node.type === this.schema.nodes.image &&
        node.attrs["data-placeholder"]
      ) {
        this.view.dispatch(this.view.state.tr.delete(pos, pos + node.nodeSize));
      }
    });
  }

  cancel(file) {
    this.view.state.doc.descendants((node, pos) => {
      if (
        node.type === this.schema.nodes.image &&
        node.attrs["data-placeholder"] &&
        node.attrs?.title === file.id
      ) {
        this.view.dispatch(this.view.state.tr.delete(pos, pos + node.nodeSize));
      }
    });
  }

  success(file, markdown) {
    /** @type {null | { node: import("prosemirror-model").Node, pos: number }} */
    let nodeToReplace = null;
    this.view.state.doc.descendants((node, pos) => {
      if (
        node.type === this.schema.nodes.image &&
        node.attrs["data-placeholder"] &&
        node.attrs?.title === file.id
      ) {
        nodeToReplace = { node, pos };
        return false;
      }
      return true;
    });

    if (!nodeToReplace) {
      return;
    }

    // keeping compatibility with plugins that change the upload markdown
    const doc = this.convertFromMarkdown(markdown);

    this.view.dispatch(
      this.view.state.tr.replaceWith(
        nodeToReplace.pos,
        nodeToReplace.pos + nodeToReplace.node.nodeSize,
        doc.content.firstChild.content
      )
    );
  }
}
