import { registerRichEditorExtension } from "discourse/lib/composer/rich-editor-extensions";
import codeBlock from "./code-block";
import emoji from "./emoji";
import hashtag from "./hashtag";
import heading from "./heading";
import htmlBlock from "./html-block";
import htmlInline from "./html-inline";
import image from "./image";
import link from "./link";
import markdownPaste from "./markdown-paste";
import mention from "./mention";
import quote from "./quote";
import strikethrough from "./strikethrough";
import table from "./table";
import typographerReplacements from "./typographer-replacements";
import underline from "./underline";

/**
 * List of default extensions
 * ProsemirrorEditor autoloads them when includeDefault=true (the default)
 *
 * @type {RichEditorExtension[]}
 */
const defaultExtensions = [
  emoji,
  image,
  link,
  heading,
  codeBlock,
  quote,
  hashtag,
  mention,
  strikethrough,
  underline,
  htmlInline,
  htmlBlock,
  typographerReplacements,
  table,
  markdownPaste,
];

defaultExtensions.forEach(registerRichEditorExtension);

export default defaultExtensions;
