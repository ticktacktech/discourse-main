import { tracked } from "@glimmer/tracking";
import { A } from "@ember/array";
import Component from "@ember/component";
import EmberObject, { action } from "@ember/object";
import { dependentKeyCompat } from "@ember/object/compat";
import { service } from "@ember/service";
import { isEmpty } from "@ember/utils";
import { observes } from "@ember-decorators/object";
import { Promise } from "rsvp";
import { ajax } from "discourse/lib/ajax";
import { setting } from "discourse/lib/computed";
import cookie, { removeCookie } from "discourse/lib/cookie";
import discourseDebounce from "discourse/lib/debounce";
import discourseComputed, { bind } from "discourse/lib/decorators";
import NameValidationHelper from "discourse/lib/name-validation-helper";
import PasswordValidationHelper from "discourse/lib/password-validation-helper";
import { userPath } from "discourse/lib/url";
import UsernameValidationHelper from "discourse/lib/username-validation-helper";
import { emailValid } from "discourse/lib/utilities";
import UserFieldsValidation from "discourse/mixins/user-fields-validation";
import { findAll } from "discourse/models/login-method";
import User from "discourse/models/user";
import { i18n } from "discourse-i18n";

export default class CreateAccount extends Component.extend(
  UserFieldsValidation
) {
  @service site;
  @service siteSettings;
  @service login;

  @tracked isDeveloper = false;
  @tracked accountName = this.model.accountName;
  @tracked accountEmail = this.model.accountEmail;
  @tracked accountUsername = this.model.accountUsername;
  @tracked accountPassword = this.model.accountPassword;
  @tracked authOptions = this.model.authOptions;
  @tracked skipConfirmation = this.model.skipConfirmation;
  accountChallenge = 0;
  accountHoneypot = 0;
  formSubmitted = false;
  rejectedEmails = A();
  prefilledUsername = null;
  userFields = null;
  maskPassword = true;
  emailValidationVisible = false;
  nameValidationHelper = new NameValidationHelper(this);
  usernameValidationHelper = new UsernameValidationHelper(this);
  passwordValidationHelper = new PasswordValidationHelper(this);

  @setting("enable_local_logins") canCreateLocal;
  @setting("require_invite_code") requireInviteCode;

  init() {
    super.init(...arguments);

    if (cookie("email")) {
      this.accountEmail = cookie("email");
    }

    this.fetchConfirmationValue();

    if (this.model.skipConfirmation) {
      this.performAccountCreation().finally(
        () => (this.skipConfirmation = false)
      );
    }
  }

  @action
  setAccountUsername(event) {
    this.accountUsername = event.target.value;
  }

  @dependentKeyCompat
  get usernameValidation() {
    return this.usernameValidationHelper.usernameValidation;
  }

  get passwordValidation() {
    return this.passwordValidationHelper.passwordValidation;
  }

  get nameTitle() {
    return this.nameValidationHelper.nameTitle;
  }

  get nameValidation() {
    return this.nameValidationHelper.nameValidation;
  }

  @dependentKeyCompat
  get hasAuthOptions() {
    return !isEmpty(this.authOptions);
  }

  @dependentKeyCompat
  get forceValidationReason() {
    return this.nameValidationHelper.forceValidationReason;
  }

  @bind
  actionOnEnter(event) {
    if (!this.submitDisabled && event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      this.createAccount();
      return false;
    }
  }

  @bind
  selectKitFocus(event) {
    const target = document.getElementById(event.target.getAttribute("for"));
    if (target?.classList.contains("select-kit")) {
      event.preventDefault();
      target.querySelector(".select-kit-header").click();
    }
  }

  get showCreateForm() {
    return (
      (this.hasAuthOptions || this.canCreateLocal) && !this.skipConfirmation
    );
  }

  @discourseComputed("site.desktopView", "hasAuthOptions")
  showExternalLoginButtons(desktopView, hasAuthOptions) {
    return desktopView && !hasAuthOptions;
  }

  @discourseComputed("formSubmitted")
  submitDisabled() {
    return this.formSubmitted;
  }

  @discourseComputed("userFields", "hasAtLeastOneLoginButton", "hasAuthOptions")
  modalBodyClasses(userFields, hasAtLeastOneLoginButton, hasAuthOptions) {
    const classes = [];
    if (userFields) {
      classes.push("has-user-fields");
    }
    if (hasAtLeastOneLoginButton && !hasAuthOptions) {
      classes.push("has-alt-auth");
    }
    if (!this.canCreateLocal) {
      classes.push("no-local-logins");
    }
    return classes.join(" ");
  }

  get usernameDisabled() {
    return this.authOptions && !this.authOptions.can_edit_username;
  }

  get nameDisabled() {
    return this.authOptions && !this.authOptions.can_edit_name;
  }

  @discourseComputed
  showFullname() {
    return this.site.full_name_visible_in_signup;
  }

  @discourseComputed
  fullnameRequired() {
    return this.site.full_name_required_for_signup;
  }

  @discourseComputed(
    "emailValidation.ok",
    "emailValidation.reason",
    "emailValidationVisible"
  )
  showEmailValidation(
    emailValidationOk,
    emailValidationReason,
    emailValidationVisible
  ) {
    return (
      emailValidationOk || (emailValidationReason && emailValidationVisible)
    );
  }

  get showPasswordValidation() {
    return this.passwordValidation.ok || this.passwordValidation.reason;
  }

  get showUsernameInstructions() {
    return (
      this.siteSettings.show_signup_form_username_instructions &&
      !this.usernameValidation.reason
    );
  }

  get passwordRequired() {
    return isEmpty(this.authOptions?.auth_provider);
  }

  @discourseComputed
  disclaimerHtml() {
    if (this.site.tos_url && this.site.privacy_policy_url) {
      return i18n("create_account.disclaimer", {
        tos_link: this.site.tos_url,
        privacy_link: this.site.privacy_policy_url,
      });
    }
  }

  // Check the email address
  @discourseComputed(
    "serverAccountEmail",
    "serverEmailValidation",
    "accountEmail",
    "rejectedEmails.[]",
    "forceValidationReason"
  )
  emailValidation(
    serverAccountEmail,
    serverEmailValidation,
    email,
    rejectedEmails,
    forceValidationReason
  ) {
    const failedAttrs = {
      failed: true,
      ok: false,
      element: document.querySelector("#new-account-email"),
    };

    if (serverAccountEmail === email && serverEmailValidation) {
      return serverEmailValidation;
    }

    // If blank, fail without a reason
    if (isEmpty(email)) {
      return EmberObject.create(
        Object.assign(failedAttrs, {
          message: i18n("user.email.required"),
          reason: forceValidationReason ? i18n("user.email.required") : null,
        })
      );
    }

    if (rejectedEmails.includes(email) || !emailValid(email)) {
      return EmberObject.create(
        Object.assign(failedAttrs, {
          reason: i18n("user.email.invalid"),
        })
      );
    }

    if (this.authOptions?.email === email && this.authOptions?.email_valid) {
      return EmberObject.create({
        ok: true,
        reason: i18n("user.email.authenticated", {
          provider: this.authProviderDisplayName(
            this.authOptions?.auth_provider
          ),
        }),
      });
    }

    return EmberObject.create({
      ok: true,
      reason: i18n("user.email.ok"),
    });
  }

  @action
  checkEmailAvailability() {
    this.set("emailValidationVisible", Boolean(this.emailValidation.reason));

    if (
      !this.emailValidation.ok ||
      this.serverAccountEmail === this.accountEmail
    ) {
      return;
    }

    return User.checkEmail(this.accountEmail)
      .then((result) => {
        if (this.isDestroying || this.isDestroyed) {
          return;
        }

        if (result.failed) {
          this.setProperties({
            serverAccountEmail: this.accountEmail,
            serverEmailValidation: EmberObject.create({
              failed: true,
              element: document.querySelector("#new-account-email"),
              reason: result.errors[0],
            }),
          });
        } else {
          this.setProperties({
            serverAccountEmail: this.accountEmail,
            serverEmailValidation: EmberObject.create({
              ok: true,
              reason: i18n("user.email.ok"),
            }),
          });
        }
      })
      .catch(() => {
        this.setProperties({
          serverAccountEmail: null,
          serverEmailValidation: null,
        });
      });
  }

  get emailDisabled() {
    return (
      this.authOptions?.email === this.accountEmail &&
      this.authOptions?.email_valid
    );
  }

  authProviderDisplayName(providerName) {
    const matchingProvider = findAll().find((provider) => {
      return provider.name === providerName;
    });
    return matchingProvider ? matchingProvider.get("prettyName") : providerName;
  }

  @observes("emailValidation", "accountEmail")
  prefillUsername() {
    if (this.prefilledUsername) {
      // If username field has been filled automatically, and email field just changed,
      // then remove the username.
      if (this.accountUsername === this.prefilledUsername) {
        this.accountUsername = "";
      }
      this.set("prefilledUsername", null);
    }
    if (
      this.get("emailValidation.ok") &&
      (isEmpty(this.accountUsername) || this.authOptions?.email)
    ) {
      // If email is valid and username has not been entered yet,
      // or email and username were filled automatically by 3rd party auth,
      // then look for a registered username that matches the email.
      discourseDebounce(
        this,
        this.usernameValidationHelper.fetchExistingUsername,
        500
      );
    }
  }

  // Determines whether at least one login button is enabled
  @discourseComputed
  hasAtLeastOneLoginButton() {
    return findAll().length > 0;
  }

  fetchConfirmationValue() {
    if (this._challengeDate === undefined && this._hpPromise) {
      // Request already in progress
      return this._hpPromise;
    }

    this._hpPromise = ajax("/session/hp.json")
      .then((json) => {
        if (this.isDestroying || this.isDestroyed) {
          return;
        }

        this._challengeDate = new Date();
        // remove 30 seconds for jitter, make sure this works for at least
        // 30 seconds so we don't have hard loops
        this._challengeExpiry = parseInt(json.expires_in, 10) - 30;
        if (this._challengeExpiry < 30) {
          this._challengeExpiry = 30;
        }

        this.setProperties({
          accountHoneypot: json.value,
          accountChallenge: json.challenge.split("").reverse().join(""),
        });
      })
      .finally(() => (this._hpPromise = undefined));

    return this._hpPromise;
  }

  performAccountCreation() {
    if (
      !this._challengeDate ||
      new Date() - this._challengeDate > 1000 * this._challengeExpiry
    ) {
      return this.fetchConfirmationValue().then(() =>
        this.performAccountCreation()
      );
    }

    const attrs = {
      accountName: this.accountName,
      accountEmail: this.accountEmail,
      accountPassword: this.accountPassword,
      accountUsername: this.accountUsername,
      accountChallenge: this.accountChallenge,
      inviteCode: this.inviteCode,
      accountPasswordConfirm: this.accountHoneypot,
    };

    const destinationUrl = this.authOptions?.destination_url;

    if (!isEmpty(destinationUrl)) {
      cookie("destination_url", destinationUrl, { path: "/" });
    }

    // Add the userFields to the data
    if (!isEmpty(this.userFields)) {
      attrs.userFields = {};
      this.userFields.forEach(
        (f) => (attrs.userFields[f.get("field.id")] = f.get("value"))
      );
    }

    this.set("formSubmitted", true);
    return User.createAccount(attrs).then(
      (result) => {
        if (this.isDestroying || this.isDestroyed) {
          return;
        }

        this.isDeveloper = false;
        if (result.success) {
          // invalidate honeypot
          this._challengeExpiry = 1;

          // Trigger the browser's password manager using the hidden static login form:
          const hiddenLoginForm = document.querySelector("#hidden-login-form");
          if (hiddenLoginForm) {
            hiddenLoginForm.querySelector("input[name=username]").value =
              attrs.accountUsername;
            hiddenLoginForm.querySelector("input[name=password]").value =
              attrs.accountPassword;
            hiddenLoginForm.querySelector("input[name=redirect]").value =
              userPath("account-created");
            hiddenLoginForm.submit();
          }
          return new Promise(() => {}); // This will never resolve, the page will reload instead
        } else {
          this.set("flash", result.message || i18n("create_account.failed"));
          if (result.is_developer) {
            this.isDeveloper = true;
          }
          if (
            result.errors &&
            result.errors.email &&
            result.errors.email.length > 0 &&
            result.values
          ) {
            this.rejectedEmails.pushObject(result.values.email);
          }
          if (result.errors?.["user_password.password"]?.length > 0) {
            this.passwordValidationHelper.rejectedPasswords.push(
              attrs.accountPassword
            );
          }
          this.set("formSubmitted", false);
          removeCookie("destination_url");
        }
      },
      () => {
        this.set("formSubmitted", false);
        removeCookie("destination_url");
        return this.set("flash", i18n("create_account.failed"));
      }
    );
  }

  get associateHtml() {
    const url = this.authOptions?.associate_url;
    if (!url) {
      return;
    }
    return i18n("create_account.associate", {
      associate_link: url,
      provider: i18n(`login.${this.authOptions.auth_provider}.name`),
    });
  }

  @action
  scrollInputIntoView(event) {
    event.target.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }

  @action
  togglePasswordMask() {
    this.toggleProperty("maskPassword");
  }

  @action
  externalLogin(provider) {
    // we will automatically redirect to the external auth service
    this.login.externalLogin(provider, { signup: true });
  }

  @action
  createAccount() {
    this.set("flash", "");
    this.nameValidationHelper.forceValidationReason = true;
    this.set("emailValidationVisible", true);

    const validation = [
      this.emailValidation,
      this.usernameValidation,
      this.nameValidation,
      this.passwordValidation,
      this.userFieldsValidation,
    ].find((v) => v.failed);

    if (validation) {
      const element = validation.element;
      if (element) {
        if (element.tagName === "DIV") {
          if (element.scrollIntoView) {
            element.scrollIntoView();
          }
          element.click();
        } else {
          element.focus();
        }
      }

      return;
    }

    this.nameValidationHelper.forceValidationReason = false;
    this.performAccountCreation();
  }
}
