/** 轻量模态框与 toast，无第三方依赖。 */

import { escapeHtml } from "./constants.js";

const CLOSE_ICON = `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;

let activeModal = null;
let previousFocus = null;

function focusable(container) {
  return [...container.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => element.offsetParent !== null);
}

export function openModal(options) {
  if (activeModal) activeModal.destroy();

  const {
    title,
    subtitle = "",
    body = "",
    footer = "",
    wide = false,
    className = "",
    onBeforeClose = null,
  } = options;

  const root = document.getElementById("modal-root") ?? document.body.appendChild(
    Object.assign(document.createElement("div"), { id: "modal-root" }),
  );

  previousFocus = document.activeElement;

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal ${wide ? "modal-wide" : ""} ${className}" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1">
      <header class="modal-head">
        <div class="modal-heading">
          <h2 id="modal-title">${escapeHtml(title)}</h2>
          ${subtitle ? `<p>${subtitle}</p>` : ""}
        </div>
        <button class="icon-btn modal-close" type="button" aria-label="关闭">${CLOSE_ICON}</button>
      </header>
      <div class="modal-body"></div>
      ${footer ? `<footer class="modal-foot">${footer}</footer>` : ""}
    </div>`;
  const modal = backdrop.querySelector(".modal");
  const bodyEl = backdrop.querySelector(".modal-body");
  if (body instanceof Node) bodyEl.append(body);
  else bodyEl.innerHTML = body;

  root.append(backdrop);
  document.body.classList.add("modal-open");

  let closed = false;
  function destroy({ restoreFocus = true } = {}) {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKeydown, true);
    backdrop.remove();
    if (!document.querySelector(".modal-backdrop")) {
      document.body.classList.remove("modal-open");
    }
    if (activeModal?.backdrop === backdrop) activeModal = null;
    if (restoreFocus && previousFocus instanceof HTMLElement) {
      previousFocus.focus({ preventScroll: true });
    }
  }

  function requestClose() {
    if (onBeforeClose && onBeforeClose() === false) return;
    destroy();
  }

  function onKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      requestClose();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusable(modal);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  backdrop.querySelector(".modal-close").addEventListener("click", requestClose);
  backdrop.addEventListener("mousedown", (event) => {
    if (event.target === backdrop) requestClose();
  });
  document.addEventListener("keydown", onKeydown, true);

  activeModal = { backdrop, destroy };

  requestAnimationFrame(() => {
    backdrop.classList.add("is-open");
    const autofocus = modal.querySelector("[data-autofocus]");
    const target = autofocus ?? modal;
    target.focus({ preventScroll: true });
  });

  return {
    element: modal,
    body: bodyEl,
    backdrop,
    close: requestClose,
    forceClose: () => destroy(),
    setFooter(html) {
      let foot = modal.querySelector(".modal-foot");
      if (!foot) {
        foot = document.createElement("footer");
        foot.className = "modal-foot";
        modal.append(foot);
      }
      foot.innerHTML = html;
      return foot;
    },
  };
}

export function confirmModal({
  title = "确认操作",
  message = "",
  confirmText = "确认",
  cancelText = "取消",
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const modal = openModal({
      title,
      body: `<p class="confirm-text">${message}</p>`,
      footer: `
        <button class="btn btn-ghost" type="button" data-cancel>${escapeHtml(cancelText)}</button>
        <button class="btn ${danger ? "btn-danger" : "btn-primary"}" type="button" data-confirm>${escapeHtml(confirmText)}</button>`,
      onBeforeClose: () => {
        finish(false);
        return true;
      },
    });
    modal.element.querySelector("[data-cancel]").addEventListener("click", () => {
      finish(false);
      modal.forceClose();
    });
    modal.element.querySelector("[data-confirm]").addEventListener("click", () => {
      finish(true);
      modal.forceClose();
    });
  });
}

export function showToast(message, { tone = "default", duration = 3600, action = null } = {}) {
  let root = document.getElementById("toast-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "toast-root";
    root.className = "toast-root";
    root.setAttribute("aria-live", "polite");
    document.body.append(root);
  }
  while (root.children.length >= 3) root.firstElementChild.remove();

  const toast = document.createElement("div");
  toast.className = `toast toast-${tone}`;
  toast.innerHTML = `<span class="toast-text">${escapeHtml(message)}</span>`;
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "toast-action";
    button.textContent = action.label;
    button.addEventListener("click", () => {
      action.onClick?.();
      dismiss();
    });
    toast.append(button);
  }
  root.append(toast);
  requestAnimationFrame(() => toast.classList.add("is-visible"));

  let timer = window.setTimeout(dismiss, duration);
  function dismiss() {
    window.clearTimeout(timer);
    toast.classList.remove("is-visible");
    window.setTimeout(() => toast.remove(), 220);
  }
  toast.addEventListener("mouseenter", () => window.clearTimeout(timer));
  toast.addEventListener("mouseleave", () => {
    timer = window.setTimeout(dismiss, 1200);
  });
  return { dismiss };
}
