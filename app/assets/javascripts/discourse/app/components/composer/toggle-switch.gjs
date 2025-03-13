import Component from "@glimmer/component";
import { on } from "@ember/modifier";
import { action } from "@ember/object";
import concatClass from "discourse/helpers/concat-class";
import icon from "discourse/helpers/d-icon";

export default class ComposerToggleSwitch extends Component {
  @action
  mouseDown(event) {
    if (this.args.preventFocus) {
      event.preventDefault();
    }
  }

  <template>
    {{! template-lint-disable no-redundant-role }}
    <button
      class={{concatClass
        "composer-toggle-switch"
        (if @state "--rte" "--markdown")
      }}
      type="button"
      role="switch"
      aria-checked={{if @state "true" "false"}}
      {{! template-lint-disable no-pointer-down-event-binding }}
      {{on "mousedown" this.mouseDown}}
      ...attributes
    >
      <span class="composer-toggle-switch__slider">
        <span
          class={{concatClass
            "composer-toggle-switch__left-icon"
            (unless @state "--active")
          }}
          aria-hidden="true"
        >{{icon "fab-markdown"}}</span>
        <span
          class={{concatClass
            "composer-toggle-switch__right-icon"
            (if @state "--active")
          }}
          aria-hidden="true"
        >{{icon "a"}}</span>
      </span>
    </button>
  </template>
}
