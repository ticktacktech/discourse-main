import * as GlimmerManager from "@glimmer/manager";
import ClassicComponent from "@ember/component";
import deprecated from "discourse/lib/deprecated";
import DiscourseTemplateMap from "discourse/lib/discourse-template-map";
import { RAW_TOPIC_LIST_DEPRECATION_OPTIONS } from "discourse/lib/plugin-api";
import { getThemeInfo } from "discourse/lib/source-identifier";

// We're using a patched version of Ember with a modified GlimmerManager to make the code below work.
// This patch is not ideal, but Ember does not allow us to change a component template after initial association
// https://github.com/glimmerjs/glimmer-vm/blob/03a4b55c03/packages/%40glimmer/manager/lib/public/template.ts#L14-L20

const LEGACY_TOPIC_LIST_OVERRIDES = ["topic-list", "topic-list-item"];

function sourceForModuleName(name) {
  const pluginMatch = name.match(/^discourse\/plugins\/([^\/]+)\//)?.[1];
  if (pluginMatch) {
    return {
      type: "plugin",
      name: pluginMatch,
    };
  }

  const themeMatch = name.match(/^discourse\/theme-(\d+)\//)?.[1];
  if (themeMatch) {
    return {
      ...getThemeInfo(parseInt(themeMatch, 10)),
      type: "theme",
    };
  }
}

export default {
  after: ["populate-template-map", "mobile"],

  initialize(owner) {
    this.site = owner.lookup("service:site");

    this.eachThemePluginTemplate((templateKey, moduleNames, mobile) => {
      if (!mobile && DiscourseTemplateMap.coreTemplates.has(templateKey)) {
        // It's a non-colocated core component. Template will be overridden at runtime.
        return;
      }

      let componentName = templateKey;
      const finalOverrideModuleName = moduleNames.at(-1);

      if (mobile) {
        deprecated(
          `Mobile-specific hbs templates are deprecated. Use responsive CSS or {{#if this.site.mobileView}} instead. [${templateKey}]`,
          {
            id: "discourse.mobile-templates",
            url: "https://meta.discourse.org/t/355668",
            source: sourceForModuleName(finalOverrideModuleName),
          }
        );
        if (this.site.mobileView) {
          componentName = componentName.slice("mobile/".length);
        }
      }

      componentName = componentName.slice("components/".length);

      const component = owner.resolveRegistration(`component:${componentName}`);

      if (!component) {
        // Plugin/theme component template with no backing class.
        // Treat as classic component to emulate pre-template-only-glimmer-component behaviour.
        owner.register(`component:${componentName}`, ClassicComponent);
        return;
      }

      // patched function: Ember's OG won't return overridden templates. This version will.
      // it's safe to call it original template here because the override wasn't set yet.
      const originalTemplate = GlimmerManager.getComponentTemplate(component);

      if (originalTemplate) {
        if (LEGACY_TOPIC_LIST_OVERRIDES.includes(componentName)) {
          // Special handling for these, with a different deprecation id, so the auto-feature-flag works correctly
          deprecated(
            `Overriding '${componentName}' template is deprecated. Use the value transformer 'topic-list-columns' and other new topic-list plugin APIs instead.`,
            {
              ...RAW_TOPIC_LIST_DEPRECATION_OPTIONS,
              source: sourceForModuleName(finalOverrideModuleName),
            }
          );
        } else {
          deprecated(
            `Overriding component templates is deprecated, and will soon be disabled. Use plugin outlets, CSS, or other customization APIs instead. [${finalOverrideModuleName}]`,
            {
              id: "discourse.component-template-overrides",
              url: "https://meta.discourse.org/t/355668",
              source: sourceForModuleName(finalOverrideModuleName),
            }
          );
        }

        const overrideTemplate = require(finalOverrideModuleName).default;

        // patched function: Ember's OG does not allow overriding a component template
        GlimmerManager.setComponentTemplate(overrideTemplate, component);
      }
    });
  },

  eachThemePluginTemplate(cb) {
    const { coreTemplates, pluginTemplates, themeTemplates } =
      DiscourseTemplateMap;

    const orderedOverrides = [
      [pluginTemplates, "components/", false],
      [themeTemplates, "components/", false],
      [coreTemplates, "mobile/components/", true],
      [pluginTemplates, "mobile/components/", true],
      [themeTemplates, "mobile/components/", true],
    ];

    for (const [map, prefix, mobile] of orderedOverrides) {
      for (const [key, value] of map) {
        if (key.startsWith(prefix)) {
          cb(key, value, mobile);
        }
      }
    }
  },

  teardown() {
    // patched function: doesn't exist on og GlimmerManager
    GlimmerManager.clearTemplateOverrides();
  },
};
