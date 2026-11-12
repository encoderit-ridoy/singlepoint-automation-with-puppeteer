// ============================================================
//  SinglePoint Auto-Insurance Quote — n8n Puppeteer Node
//  login → driver → vehicles → options → premiums → PDF
//
//  CHANGE LOG (v3 — 2026-11-12):
//   - ROOT-CAUSE FIX: date fields (DOB / First Licensed / prior exp) are
//     masked inputs. Typing digits key-by-key raced the mask and dropped
//     characters ("09181999" → "09/81/9"). setDateInput now sets the
//     formatted value in one shot via the native value setter + input/
//     change/blur events, then falls back to slow typing, and verifies.
//   - setDateInput no longer presses Escape — Escape closed the Client
//     info modal before "Update info" was clicked, which is why client
//     DOB never stuck ("Required Date of Birth for client").
//   - Manual (non-MA licence) flow: driver tab is verified and re-filled
//     before leaving it; gender + marital status are now filled.
//   - Vehicle garaging zip is verified (it was ending up blank).
//   - Options: prior carrier + prior expiration come from the webhook
//     when present (fallback: "Other" / today + 1 yr).
//   - New REVIEW_FIXERS: gender, marital status.
//   - SPR login read from n8n env vars when available.
// ============================================================

// ─────────────────────────────────────────────────────────────
//  0.  HELPERS
// ─────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// "YYYY-MM-DD" (or anything Date can parse) → "MMDDYYYY"
function formatDateToMMDDYYYY(dateStr) {
  if (!dateStr) return "";
  const iso = String(dateStr).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return `${iso[2].padStart(2, "0")}${iso[3].padStart(2, "0")}${iso[1]}`;
  }
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}${day}${date.getFullYear()}`;
}

// Open a custom autocomplete / select-like input so options appear
async function openSelectLike(page, inputSel) {
  await page.waitForSelector(inputSel, { timeout: 30000 });
  await page.evaluate(
    (s) => document.querySelector(s)?.scrollIntoView({ block: "center" }),
    inputSel,
  );
  await page.click(inputSel).catch(() => {});
  await page.focus(inputSel).catch(() => {});
  await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (el) el.removeAttribute("readonly");
  }, inputSel);
  await page.keyboard.press("ArrowDown").catch(() => {});
  await page.keyboard.press("Space").catch(() => {});
  await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return;
    const root =
      el.closest(
        ".sm-input-select,.autocomplete,.ng-select,.mat-select,.dropdown,.select-wrapper",
      ) || el.parentElement;
    const btn =
      root &&
      root.querySelector(
        'button,[role="button"],.icon-chevron,.icon-caret,.autocomplete__btn,.sm-input-select__btn',
      );
    if (btn) btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  }, inputSel);
}

// Click an option by text — near the input, then globally. With
// allowBlindPick=false the "ArrowDown+Enter" fallback is skipped so a
// wrong option is never chosen silently.
async function pickByTextRobust(page, inputSel, text, allowBlindPick = true) {
  const nearSels = [
    ".sm-input-select__menu .sm-input-select__option",
    ".autocomplete__menu .autocomplete__item",
    "ul li",
    "li",
    '[role="option"]',
    "[data-option]",
    ".option",
    ".item",
  ];
  const globalSels = [
    '.cdk-overlay-container [role="option"]',
    '.cdk-overlay-pane [role="option"]',
    ".mat-select-panel .mat-option",
    ".ng-dropdown-panel .ng-option",
    ".ng-select .ng-option",
    ".sm-input-select__menu .sm-input-select__option",
    ".autocomplete__menu .autocomplete__item",
    ".dropdown-menu .dropdown-item",
    '[role="listbox"] [role="option"]',
    '[role="option"]',
  ];

  const near = await page.evaluate(
    (s, target, sels) => {
      const norm = (x) => (x || "").trim().toLowerCase();
      const host = document.querySelector(s);
      if (!host) return false;
      const root =
        host.closest(
          ".sm-input-select,.autocomplete,.ng-select,.mat-select,.dropdown,.select-wrapper,form,div",
        ) ||
        host.parentElement ||
        document.body;
      for (const sel of sels) {
        const vis = Array.from(root.querySelectorAll(sel)).filter(
          (n) => !!(n.offsetParent || n.getClientRects().length),
        );
        const hit =
          vis.find((n) => norm(n.textContent) === norm(target)) ||
          vis.find((n) => norm(n.textContent).startsWith(norm(target))) ||
          vis.find((n) => norm(n.textContent).includes(norm(target)));
        if (hit) {
          hit.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
          hit.click();
          return true;
        }
      }
      return false;
    },
    inputSel,
    text,
    nearSels,
  );
  if (near) return true;

  const global_ = await page.evaluate(
    (target, sels) => {
      const norm = (x) => (x || "").trim().toLowerCase();
      for (const sel of sels) {
        const vis = Array.from(document.querySelectorAll(sel)).filter(
          (n) => !!(n.offsetParent || n.getClientRects().length),
        );
        const hit =
          vis.find((n) => norm(n.textContent) === norm(target)) ||
          vis.find((n) => norm(n.textContent).startsWith(norm(target))) ||
          vis.find((n) => norm(n.textContent).includes(norm(target)));
        if (hit) {
          hit.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
          hit.click();
          return true;
        }
      }
      return false;
    },
    text,
    globalSels,
  );
  if (global_) return true;

  if (!allowBlindPick) return false;
  try {
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    return true;
  } catch (_) {}
  return false;
}

// open → clear → type → pick → tab
async function fillSelectLike(page, inputSel, value, allowBlindPick = true) {
  await openSelectLike(page, inputSel);
  await page.click(inputSel, { clickCount: 3 }).catch(() => {});
  for (let i = 0; i < 8; i++) {
    try {
      await page.keyboard.press("Backspace");
    } catch (_) {}
  }
  await page.type(inputSel, value, { delay: 70 });
  await sleep(500);
  const ok = await pickByTextRobust(page, inputSel, value, allowBlindPick);
  await page.keyboard.press("Tab").catch(() => {});
  await sleep(300);
  return ok;
}

// Fill a select-like field and confirm the input now contains the wanted
// text. Returns the final value ("" = failed).
async function fillSelectVerified(page, sel, value, { attempts = 2 } = {}) {
  if (!value || !(await page.$(sel))) return "";
  for (let i = 1; i <= attempts; i++) {
    await fillSelectLike(page, sel, value, false).catch(() => {});
    const got = await page
      .$eval(sel, (el) => (el.value || "").trim())
      .catch(() => "");
    if (got && got.toLowerCase().includes(value.toLowerCase())) return got;
    console.warn(
      `fillSelectVerified ${sel}: wanted "${value}", got "${got}" (attempt ${i})`,
    );
  }
  return "";
}

async function selectFirstAvailableOption(page, inputSel) {
  await openSelectLike(page, inputSel);
  await sleep(400);
  const picked = await page.evaluate(() => {
    const sels = [
      '.cdk-overlay-container [role="option"]',
      '.cdk-overlay-pane [role="option"]',
      ".mat-select-panel .mat-option",
      ".ng-dropdown-panel .ng-option",
      ".ng-select .ng-option",
      ".sm-input-select__menu .sm-input-select__option",
      ".autocomplete__menu .autocomplete__item",
      ".dropdown-menu .dropdown-item",
      '[role="listbox"] [role="option"]',
      '[role="option"]',
    ];
    for (const sel of sels) {
      const vis = Array.from(document.querySelectorAll(sel)).filter(
        (n) => !!(n.offsetParent || n.getClientRects().length),
      );
      if (vis.length) {
        vis[0].dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        vis[0].click();
        return true;
      }
    }
    return false;
  });
  await page.keyboard.press("Tab").catch(() => {});
  return picked;
}

// First option containing `prefer`, else the first option. Verifies.
async function selectOptionPreferring(page, inputSel, prefer = "") {
  for (let attempt = 0; attempt < 3; attempt++) {
    await openSelectLike(page, inputSel);
    await sleep(800 + attempt * 700);
    const picked = await page.evaluate(
      (s, prefer) => {
        const host = document.querySelector(s);
        const sels = [
          ".sm-input-select__menu .sm-input-select__option",
          ".autocomplete__menu .autocomplete__item",
          ".autocomplete__list li",
          ".ng-dropdown-panel .ng-option",
          ".mat-select-panel .mat-option",
          '.cdk-overlay-container [role="option"]',
          '[role="listbox"] [role="option"]',
          '[role="option"]',
          ".dropdown-menu .dropdown-item",
        ];
        const visible = (n) => !!(n.offsetParent || n.getClientRects().length);
        const root =
          host?.closest(
            ".sm-input-select,.autocomplete,.ng-select,.mat-select,.dropdown",
          ) || null;
        for (const scope of [root, document].filter(Boolean)) {
          for (const sel of sels) {
            const opts = Array.from(scope.querySelectorAll(sel)).filter(
              (n) => visible(n) && (n.textContent || "").trim(),
            );
            if (!opts.length) continue;
            const p = (prefer || "").toLowerCase();
            const hit =
              (p &&
                opts.find((n) => n.textContent.toLowerCase().includes(p))) ||
              opts[0];
            hit.scrollIntoView({ block: "center" });
            hit.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
            hit.click();
            return (hit.textContent || "").trim();
          }
        }
        return "";
      },
      inputSel,
      prefer,
    );
    await page.keyboard.press("Tab").catch(() => {});
    await sleep(600);
    const value = await page
      .$eval(inputSel, (el) => (el.value || "").trim())
      .catch(() => "");
    console.log(
      `selectOptionPreferring ${inputSel}: picked "${picked}", value now "${value}"`,
    );
    if (value) return value;
  }
  return "";
}

// Visible DOB input inside rootSel (by id/name/placeholder or label text)
async function findDobInput(page, rootSel = "body") {
  return page.evaluate((rootSel) => {
    const root = document.querySelector(rootSel);
    if (!root) return null;
    const visible = (n) => !!(n.offsetParent || n.getClientRects().length);
    const re = /birth|\bdob\b/i;
    const inputs = Array.from(root.querySelectorAll("input")).filter(visible);
    let target = inputs.find((i) =>
      re.test(
        `${i.id} ${i.name} ${i.placeholder} ${i.getAttribute("aria-label") || ""}`,
      ),
    );
    if (!target) {
      for (const lbl of root.querySelectorAll(
        "label, .o-label, th, td, span, div",
      )) {
        if (lbl.children.length > 3) continue;
        if (!re.test(lbl.textContent || "")) continue;
        const forId = lbl.getAttribute && lbl.getAttribute("for");
        const cand =
          (forId && document.getElementById(forId)) ||
          lbl.querySelector("input") ||
          lbl.parentElement?.querySelector("input") ||
          lbl.closest("tr")?.querySelector("input");
        if (cand && visible(cand)) {
          target = cand;
          break;
        }
      }
    }
    if (!target) return null;
    document
      .querySelectorAll("[data-dob-target]")
      .forEach((n) => n.removeAttribute("data-dob-target"));
    target.setAttribute("data-dob-target", "1");
    return "[data-dob-target]";
  }, rootSel);
}

// Is the Client info edit form currently open?
async function clientFormOpen(page) {
  return page
    .$eval(
      "#clientInfoAddrZip_StreetAddress",
      (el) => !!(el.offsetParent || el.getClientRects().length),
    )
    .catch(() => false);
}

// Open the "Client:" box edit form, set client DOB, click "Update info".
async function setClientDob(page, mmddyyyy) {
  if (!(await clientFormOpen(page))) {
    const opened = await page.evaluate(() => {
      const box = Array.from(document.querySelectorAll(".aboutbox")).find(
        (b) =>
          b.querySelector(".aboutbox__title")?.textContent.trim() === "Client:",
      );
      const link = box?.querySelector("a.aboutbox__link");
      if (!link) return false;
      link.scrollIntoView({ block: "center" });
      link.click();
      return true;
    });
    if (!opened) {
      console.warn("Client box / edit link not found");
      return false;
    }
    await page
      .waitForSelector("#clientInfoAddrZip_StreetAddress", {
        visible: true,
        timeout: 10000,
      })
      .catch(() => {});
    await sleep(800);
  }
  const ok = await fillClientDobInOpenForm(page, mmddyyyy);
  await clickUpdateInfo(page);
  return ok;
}

async function fillClientDobInOpenForm(page, mmddyyyy) {
  if (!mmddyyyy) return false;
  await page.evaluate(() => {
    document
      .querySelectorAll("[data-client-form]")
      .forEach((n) => n.removeAttribute("data-client-form"));
    const zip = document.querySelector("#clientInfoAddrZip_StreetAddress");
    const root =
      zip?.closest(
        ".modalbox__content, .modalbox, [role='dialog'], .sm-popup, form",
      ) || null;
    if (root) root.setAttribute("data-client-form", "1");
  });
  const sel =
    (await page
      .$("#clientInfoDateOfBirth")
      .then((h) => (h ? "#clientInfoDateOfBirth" : null))) ||
    (await findDobInput(page, "[data-client-form]"));
  if (!sel) {
    console.warn("Client DOB input not found in client info form");
    return false;
  }
  const ok = await setDateInput(page, sel, mmddyyyy);
  console.log(`Client DOB (${sel}) set: ${ok}`);
  return ok;
}

async function clickUpdateInfo(page) {
  const clicked = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button.o-btn")).find(
      (b) => b.textContent.trim() === "Update info" && b.offsetParent !== null,
    );
    if (!btn) return false;
    btn.scrollIntoView({ block: "center" });
    btn.click();
    return true;
  });
  if (!clicked)
    console.warn('"Update info" button not found (form may have closed)');
  await sleep(3000);
  return clicked;
}

async function fillNumericAutocomplete(page, sel, value) {
  await page.waitForSelector(sel, { timeout: 15000 });
  await page.$eval(sel, (el) => el.scrollIntoView({ block: "center" }));
  await page.focus(sel);
  await page.keyboard.down("Control").catch(() => {});
  await page.keyboard.press("KeyA").catch(() => {});
  await page.keyboard.up("Control").catch(() => {});
  await page.keyboard.press("Backspace");
  await page.keyboard.type(String(value), { delay: 80 });
  await page.keyboard.press("Tab");
  await sleep(300);

  const current = await page
    .$eval(sel, (el) => el.value || el.getAttribute("value") || "")
    .catch(() => "");

  if (current !== String(value)) {
    await page.evaluate((s) => {
      const input = document.querySelector(s);
      if (!input) return;
      const root = input.closest(".autocomplete") || input.parentElement;
      const toggle = root && root.querySelector(".autocomplete__btn-toggle");
      if (toggle) toggle.click();
      else input.click();
    }, sel);
    await page
      .waitForSelector(
        '.autocomplete__list,[role="listbox"],.cdk-overlay-container',
        {
          timeout: 4000,
        },
      )
      .catch(() => {});
    await page.evaluate((v) => {
      const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
      const candidates = [
        ...document.querySelectorAll(".autocomplete__list *"),
        ...document.querySelectorAll('[role="listbox"] *'),
        ...document.querySelectorAll(
          '.cdk-overlay-container [role="option"],.cdk-overlay-container *',
        ),
      ];
      const target = candidates.find((el) =>
        new RegExp(`^${v}\\b`).test(norm(el.textContent)),
      );
      if (target) {
        target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        target.click();
      }
    }, String(value));
    await sleep(250);
    await page.evaluate(
      (s, v) => {
        const el = document.querySelector(s);
        if (!el) return;
        el.value = v;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("blur", { bubbles: true }));
      },
      sel,
      String(value),
    );
    await sleep(150);
  }
  await page.keyboard.press("Tab").catch(() => {});
  await sleep(150);
}

// Clear any input: native setter "" + select-all + backspace
async function clearInput(page, sel) {
  await page
    .$eval(sel, (el) => el.scrollIntoView({ block: "center" }))
    .catch(() => {});
  await page.focus(sel).catch(() => {});
  await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, sel);
  await page.click(sel, { clickCount: 3 }).catch(() => {});
  await page.keyboard.down("Control").catch(() => {});
  await page.keyboard.press("KeyA").catch(() => {});
  await page.keyboard.up("Control").catch(() => {});
  for (let i = 0; i < 12; i++)
    await page.keyboard.press("Backspace").catch(() => {});
  await sleep(150);
}

// Leave a date field without pressing Escape (Escape closes modals such
// as the Client info form). Blur + Tab closes the calendar popup.
async function leaveField(page, sel) {
  await page.keyboard.press("Tab").catch(() => {});
  await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  }, sel);
}

// Masked date input (MM/DD/YYYY). Typing digit-by-digit races the mask and
// loses characters (seen: "09181999" → "09/81/9"), so try in order:
//   A) native value setter with the fully formatted value + events
//   B) type the formatted value (with slashes) slowly
//   C) type digits one at a time, pressing End before each one
// Each attempt is verified after a pause (the app can reformat or clear).
// opts.force: re-enter even if the box already shows the right date
// opts.keyboardFirst: try real keystrokes before the native setter (the
//   app only copies the Insured driver's DOB to the client record when it
//   sees real key/blur events — the DOM value alone isn't enough)
async function setDateInput(
  page,
  sel,
  mmddyyyy,
  { force = false, keyboardFirst = false } = {},
) {
  if (!mmddyyyy) return false;
  await page.waitForSelector(sel, { visible: true, timeout: 10000 });
  const digits = mmddyyyy.replace(/\D/g, "");
  if (digits.length !== 8) {
    console.warn(`setDateInput ${sel}: bad date "${mmddyyyy}"`);
    return false;
  }
  const slashed = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  const read = () =>
    page
      .$eval(sel, (el) => (el.value || "").replace(/\D/g, ""))
      .catch(() => "");

  if (!force && (await read()) === digits) return true;

  let strategies = [
    [
      "native-setter",
      async () => {
        await clearInput(page, sel);
        await page.evaluate(
          (s, v) => {
            const el = document.querySelector(s);
            if (!el) return;
            el.focus();
            const setter = Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype,
              "value",
            ).set;
            setter.call(el, v);
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          },
          sel,
          slashed,
        );
      },
    ],
    [
      "type-slashed",
      async () => {
        await clearInput(page, sel);
        await page.focus(sel).catch(() => {});
        await page.keyboard.type(slashed, { delay: 180 });
      },
    ],
    [
      "type-digit-by-digit",
      async () => {
        await clearInput(page, sel);
        await page.focus(sel).catch(() => {});
        for (const ch of digits) {
          await page.keyboard.press("End").catch(() => {});
          await page.keyboard.type(ch);
          await sleep(220);
        }
      },
    ],
  ];

  if (keyboardFirst) strategies = [strategies[1], strategies[2], strategies[0]];

  for (const [name, run] of strategies) {
    try {
      await run();
      await leaveField(page, sel);
      await sleep(1200);
      const got = await read();
      if (got === digits) {
        console.log(`setDateInput ${sel} = ${slashed} (via ${name})`);
        return true;
      }
      console.warn(
        `setDateInput ${sel}: wanted ${slashed}, got "${got}" via ${name}`,
      );
    } catch (e) {
      console.warn(`setDateInput ${sel} ${name} error: ${e.message}`);
    }
  }
  return false;
}

async function hasValue(page, sel, minDigits = 0) {
  const v = await page
    .$eval(sel, (el) => (el.value || "").trim())
    .catch(() => "");
  return minDigits ? v.replace(/\D/g, "").length >= minDigits : !!v;
}

async function fillSdipIfEmpty(page) {
  await page.waitForSelector("#driverSdip", { visible: true, timeout: 5000 });
  if (await hasValue(page, "#driverSdip")) {
    console.log("SDIP already filled — leaving it as is");
    return;
  }
  await page.type("#driverSdip", "00", { delay: 100 });
  await page.keyboard.press("Tab");
  await sleep(500);
}

async function saveQuote(page) {
  const sel = "button.app-button.app-button--save-quote";
  await page.waitForSelector(sel, { visible: true, timeout: 10000 });
  await page.$eval(sel, (el) => el.scrollIntoView({ block: "center" }));
  await page.click(sel, { delay: 50 });
  await sleep(2000);
}

async function setTextInput(page, sel, value) {
  await page.waitForSelector(sel, { visible: true, timeout: 10000 });
  await page.$eval(sel, (el) => el.scrollIntoView({ block: "center" }));
  await page.click(sel, { clickCount: 3 }).catch(() => {});
  await page.keyboard.press("Backspace");
  await page.keyboard.type(String(value), { delay: 100 });
  await page.evaluate(
    (s, v) => {
      const el = document.querySelector(s);
      if (!el) return;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set;
      setter.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    sel,
    String(value),
  );
  await page.keyboard.press("Tab");
  await sleep(300);
}

async function ensureVehiclePrice(page) {
  const sel = "#vehiclePriceValue";
  if (!(await page.$(sel))) {
    console.warn("Price New / Value field (#vehiclePriceValue) not found");
    return false;
  }
  const current = await page.$eval(sel, (el) => (el.value || "").trim());
  if (current) return true;
  const disabled = await page
    .$eval(sel, (el) => !!el.disabled)
    .catch(() => false);
  if (disabled) return true; // app controls it (VIN lookup) — nothing to type
  const price = vehiclePriceNew || DEFAULT_PRICE_NEW;
  if (!vehiclePriceNew)
    console.warn(`No price in webhook — using default ${price}`);
  await setTextInput(page, sel, price);
  const after = await page.$eval(sel, (el) => (el.value || "").trim());
  console.log(`Price New / Value now "${after}"`);
  return !!after;
}

// Vehicle garaging zip — set and verify (it was ending up blank because
// the city autocomplete re-renders the address block after zip is typed).
async function ensureVehicleZip(page) {
  const sel = "#vehicleLocationZip";
  if (!locationZip || !(await page.$(sel))) return false;
  for (let i = 1; i <= 3; i++) {
    const v = await page
      .$eval(sel, (el) => (el.value || "").replace(/\D/g, ""))
      .catch(() => "");
    if (v.startsWith(locationZip.replace(/\D/g, "").slice(0, 5))) return true;
    await setTextInput(page, sel, locationZip);
    await sleep(1500);
  }
  const final = await page.$eval(sel, (el) => el.value || "").catch(() => "");
  console.warn(`Vehicle zip after retries: "${final}"`);
  return !!final.trim();
}

// Gender + marital status on the (open) Drivers tab, only if empty.
async function fillDriverDemographics(page) {
  let ok = true;
  if (
    genderText &&
    (await page.$("#driverGender")) &&
    !(await hasValue(page, "#driverGender"))
  ) {
    const v = await fillSelectVerified(page, "#driverGender", genderText);
    console.log(`Driver gender = "${v}"`);
    if (!v) ok = false;
  }
  if (
    maritalText &&
    (await page.$("#driverMaritalStatus")) &&
    !(await hasValue(page, "#driverMaritalStatus"))
  ) {
    let v = await fillSelectVerified(page, "#driverMaritalStatus", maritalText);
    if (!v && maritalText !== "Single") {
      v = await fillSelectVerified(page, "#driverMaritalStatus", "Single");
    }
    console.log(`Driver marital status = "${v}"`);
    if (!v) ok = false;
  }
  return ok;
}

// Final check of the Drivers tab before moving on; re-fills anything that
// didn't stick. Returns a list of problems (empty = all good).
async function verifyDriverTab(page) {
  const problems = [];
  const dob = formatDateToMMDDYYYY(dobRaw);
  if (dob && (await page.$("#driverDateOfBirth"))) {
    const okDob =
      (await hasValue(page, "#driverDateOfBirth", 8)) &&
      (await page.$eval("#driverDateOfBirth", (el) =>
        el.value.replace(/\D/g, ""),
      )) === dob;
    if (!okDob && !(await setDateInput(page, "#driverDateOfBirth", dob)))
      problems.push("driver DOB");
  }
  if (effectiveFirstLicenseDate && (await page.$("#driverFirstLicensed"))) {
    if (
      !(await hasValue(page, "#driverFirstLicensed", 8)) &&
      !(await setDateInput(
        page,
        "#driverFirstLicensed",
        formatDateToMMDDYYYY(effectiveFirstLicenseDate),
      ))
    )
      problems.push("first licensed");
  }
  if (!(await fillDriverDemographics(page))) problems.push("gender/marital");
  if (problems.length)
    console.warn("Driver tab still missing:", problems.join(", "));
  return problems;
}

// Drivers tab must be open. Makes sure driver 1 is "Insured" (picked from
// the dropdown, not just typed), then re-enters the DOB with real
// keystrokes so SinglePoint copies it to the client record.
async function syncInsuredDob(page) {
  const dob = formatDateToMMDDYYYY(dobRaw);
  if (!dob) return false;
  const rel = await page
    .$eval("#driverRelationshipToInsured", (el) => (el.value || "").trim())
    .catch(() => "");
  if (!/^insured$/i.test(rel)) {
    const v = await fillSelectVerified(
      page,
      "#driverRelationshipToInsured",
      "Insured",
    );
    console.log(`Relationship to insured = "${v}"`);
    await sleep(800);
  }
  const ok = await setDateInput(page, "#driverDateOfBirth", dob, {
    force: true,
    keyboardFirst: true,
  });
  await sleep(1000);
  console.log(`Insured DOB re-entered for client sync: ${ok}`);
  return ok;
}

async function retry(label, fn, { attempts = 3, delay = 3000, between } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn(i);
    } catch (e) {
      lastErr = e;
      console.warn(`${label} failed (attempt ${i}/${attempts}): ${e.message}`);
      if (i < attempts) {
        await sleep(delay);
        if (between) await between().catch(() => {});
      }
    }
  }
  throw lastErr;
}

const quoteUrl = () => {
  try {
    return $page.url();
  } catch (_) {
    return "unknown";
  }
};

async function goToTab(page, name) {
  await page.click(`.tabs__list .tabs__item a[href*="${name}"]`);
  await sleep(1500);
}

// ─────────────────────────────────────────────────────────────
//  OPTIONS-TAB HELPERS
// ─────────────────────────────────────────────────────────────

// Policy History — autocomplete inputs (plain typing doesn't stick)
const POLICY_HISTORY_FIELDS = [
  { sel: "#yearsWithThisCarrier", value: "6" },
  { sel: "#yearsWithCurrentAgency", value: "6" },
  { sel: "#lapsedDaysLast12Months", value: "0" },
  { sel: "#priorBodilyInjurylimits", value: "100/300", plain: true },
];

async function fillPolicyHistory(page, { onlyEmpty = false } = {}) {
  let allOk = true;
  for (const f of POLICY_HISTORY_FIELDS) {
    try {
      if (!(await page.$(f.sel))) {
        console.warn(`Policy History field ${f.sel} not on page — skipped`);
        continue;
      }
      if (onlyEmpty && (await hasValue(page, f.sel))) continue;
      if (f.plain) {
        await page.click(f.sel, { clickCount: 3 });
        await page.keyboard.press("Backspace");
        await page.keyboard.type(f.value, { delay: 100 });
        await page.keyboard.press("Tab");
        await sleep(300);
      } else {
        await fillNumericAutocomplete(page, f.sel, f.value);
      }
      const v = await page
        .$eval(f.sel, (el) => (el.value || "").trim())
        .catch(() => "");
      console.log(`Policy History ${f.sel} = "${v}"`);
      if (!v) allOk = false;
    } catch (e) {
      console.warn(`Policy History ${f.sel} failed: ${e.message}`);
      allOk = false;
    }
  }
  return allOk;
}

async function ensureChecked(page, baseId) {
  const SEL_ITEM = `#${baseId}`;
  const SEL_INPUT = `#${baseId}_checkbox`;
  const SEL_ICON = `#${baseId}_checkbox + i.o-btn.o-btn--checkbox`;

  await page.waitForSelector(SEL_ITEM, { timeout: 15000 });
  await page.$eval(SEL_ITEM, (el) =>
    el.scrollIntoView({ block: "center", inline: "center" }),
  );

  const already = await page
    .$eval(SEL_INPUT, (el) => !!el.checked)
    .catch(() => false);
  if (already) return false;

  try {
    await page.waitForSelector(SEL_ICON, { timeout: 2000 });
    await page.click(SEL_ICON, { delay: 20 });
    await sleep(150);
  } catch (_) {
    await page.click(`${SEL_ITEM} label.o-checkable`).catch(() => {});
    await sleep(150);
  }

  let checked = await page
    .$eval(SEL_INPUT, (el) => !!el.checked)
    .catch(() => false);
  if (!checked) {
    await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return;
      try {
        el.click();
      } catch (_) {}
      if (!el.checked) el.checked = true;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    }, SEL_INPUT);
    await sleep(120);
    checked = await page
      .$eval(SEL_INPUT, (el) => !!el.checked)
      .catch(() => false);
  }
  if (!checked) {
    const h =
      (await page.$(SEL_ICON)) ||
      (await page.$(`${SEL_ITEM} label.o-checkable`));
    if (h) {
      const box = await h.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await sleep(150);
      }
    }
  }
  return true;
}

const REQUIRED_OPTION_ANSWERS = [
  {
    match: /length of time for continuous coverage/i,
    answer: /36\s*\+\s*months?/,
    fallback: "last",
  },
  {
    match: /travelers.*continuous insurance/i,
    answer: /less\s+than\s+3\s+years?/,
    fallback: "first",
  },
  {
    match: /travelers.*primary residence type/i,
    answer: /^other$/,
    fallback: "first",
  },
];

async function findRequiredUncheckedOptions(page) {
  return page.evaluate(() => {
    const isRed = (el) => {
      const m = getComputedStyle(el).color.match(/\d+/g);
      if (!m) return false;
      const [r, g, b] = m.map(Number);
      return r > 150 && g < 110 && b < 110;
    };
    const out = [];
    for (const input of document.querySelectorAll('input[id$="_checkbox"]')) {
      if (input.checked || input.disabled) continue;
      const baseId = input.id.replace(/_checkbox$/, "");
      const item = document.getElementById(baseId);
      if (!item) continue;
      const textEls = Array.from(item.querySelectorAll("*")).filter((el) =>
        Array.from(el.childNodes).some(
          (n) => n.nodeType === 3 && n.textContent.trim(),
        ),
      );
      if (!textEls.some(isRed)) continue;
      const title = (item.innerText || "").split("\n")[0].trim();
      out.push({ baseId, title });
    }
    return out;
  });
}

async function handleRequiredOptions(page) {
  const attempts = {};
  for (let round = 0; round < 10; round++) {
    const pending = (await findRequiredUncheckedOptions(page)).filter(
      (o) => (attempts[o.baseId] || 0) < 2,
    );
    if (!pending.length) break;
    for (const { baseId, title } of pending) {
      attempts[baseId] = (attempts[baseId] || 0) + 1;
      console.log(`Options: required item → ${title || baseId}`);
      try {
        await ensureChecked(page, baseId);
        const hasModal = await page
          .waitForSelector('label.o-checkable input[name="parsedItemOption"]', {
            timeout: 4000,
          })
          .then(() => true)
          .catch(() => false);
        if (hasModal) {
          const rule = REQUIRED_OPTION_ANSWERS.find((r) => r.match.test(title));
          await pickModalRadio(
            page,
            rule ? rule.answer : /(?!)/,
            rule ? rule.fallback : "first",
          );
          await saveModal(page);
        }
        await sleep(500);
      } catch (e) {
        console.warn(`Options: could not handle "${title}": ${e.message}`);
      }
    }
  }
  const left = await findRequiredUncheckedOptions(page);
  if (left.length) {
    console.warn(
      "Options: still required/unchecked →",
      left.map((o) => o.title || o.baseId).join(", "),
    );
  }
}

async function pickModalRadio(page, textRegex, fallback) {
  await page.waitForSelector(
    'label.o-checkable input[name="parsedItemOption"]',
    { timeout: 15000 },
  );
  const picked = await page.evaluate(
    (reStr) => {
      const re = new RegExp(reStr, "i");
      const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
      for (const label of document.querySelectorAll("label.o-checkable")) {
        if (!re.test(norm(label.innerText || label.textContent))) continue;
        const icon = label.querySelector("i.o-btn.o-btn--radio");
        const input = label.querySelector(
          'input[type="radio"][name="parsedItemOption"]',
        );
        if (icon) {
          icon.scrollIntoView({ block: "center" });
          icon.click();
        } else {
          label.scrollIntoView({ block: "center" });
          label.click();
        }
        if (input) {
          if (!input.checked) input.checked = true;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return true;
      }
      return false;
    },
    textRegex.source || String(textRegex),
  );

  if (!picked) {
    await page.evaluate((fb) => {
      const items = Array.from(
        document.querySelectorAll(
          'label.o-checkable input[name="parsedItemOption"]',
        ),
      );
      if (!items.length) return;
      const target =
        fb === "last"
          ? items[items.length - 2] || items[items.length - 1]
          : items[0];
      if (!target) return;
      const label = target.closest("label.o-checkable");
      if (!label) return;
      const icon = label.querySelector("i.o-btn.o-btn--radio");
      if (icon) {
        icon.scrollIntoView({ block: "center" });
        icon.click();
      } else {
        label.scrollIntoView({ block: "center" });
        label.click();
      }
      if (!target.checked) target.checked = true;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
    }, fallback);
  }
}

async function saveModal(page) {
  await page.waitForSelector(".o-btn.u-spacing--right-2", { timeout: 10000 });
  await page.evaluate(() => {
    const saveBtn = Array.from(
      document.querySelectorAll("button.o-btn.u-spacing--right-2"),
    ).find((b) => (b.textContent || "").trim().toLowerCase() === "save");
    if (saveBtn) {
      saveBtn.scrollIntoView({ block: "center" });
      saveBtn.click();
    }
  });
  await page
    .waitForFunction(
      () =>
        !document.querySelector(
          '.modalbox__content,.box--silver,[role="dialog"]',
        ),
      { timeout: 10000 },
    )
    .catch(() => {});
}

// ─────────────────────────────────────────────────────────────
//  PREMIUMS-TAB HELPERS
// ─────────────────────────────────────────────────────────────

async function rowButton(
  page,
  textRe,
  { carrier = null, excludeCarrier = null, click = true } = {},
) {
  return page.evaluate(
    (reSrc, carrier, exclude, click) => {
      const re = new RegExp(reSrc, "i");
      const norm = (s) => (s || "").toLowerCase();
      for (const row of document.querySelectorAll("table.table tbody tr")) {
        const t = norm(row.innerText);
        if (carrier && !t.includes(norm(carrier))) continue;
        if (exclude && t.includes(norm(exclude))) continue;
        const btn = Array.from(
          row.querySelectorAll("button, a, .o-btn, span"),
        ).find(
          (b) =>
            re.test((b.textContent || "").trim()) &&
            b.offsetParent !== null &&
            !b.disabled,
        );
        if (!btn) continue;
        if (click) {
          btn.scrollIntoView({ block: "center" });
          btn.click();
        }
        return true;
      }
      return false;
    },
    textRe.source,
    carrier,
    excludeCarrier,
    click,
  );
}

const SUMMARY_RE = /^view\s*plan\s*summary$/;
const RATE_RE = /^rate$/;
const REVIEW_RE = /^review$/;

async function findAndOpenPlanSummary(page, carrier = null) {
  return rowButton(page, SUMMARY_RE, { carrier });
}

async function describeTab(page, name) {
  await goToTab(page, name);
  await sleep(1000);
  return page.evaluate(() => {
    const visible = (n) => !!(n.offsetParent || n.getClientRects().length);
    const labelOf = (el) => {
      const byFor = el.id && document.querySelector(`label[for="${el.id}"]`);
      const t =
        byFor?.textContent ||
        el.closest("label")?.textContent ||
        el
          .closest(".o-field, .form-group, tr, .row, div")
          ?.querySelector("label, .o-label, th")?.textContent ||
        "";
      return t.replace(/\s+/g, " ").trim().slice(0, 60);
    };
    return {
      url: location.href,
      modals: Array.from(
        document.querySelectorAll(
          '.modalbox__content, [role="dialog"], .sm-popup.is-active',
        ),
      )
        .filter(visible)
        .map((m) => (m.innerText || "").replace(/\s+/g, " ").slice(0, 120)),
      fields: Array.from(document.querySelectorAll("input, select, textarea"))
        .filter(
          (el) => visible(el) && el.type !== "hidden" && (el.id || el.name),
        )
        .slice(0, 40)
        .map((el) => ({
          id: el.id || undefined,
          name: el.name || undefined,
          label: labelOf(el) || undefined,
          value:
            el.type === "checkbox" ? el.checked : (el.value || "").slice(0, 40),
          disabled: el.disabled || undefined,
        })),
    };
  });
}

async function clickRateAllPlans(page) {
  return retry("Rate All Plans", () => clickRateAllPlansOnce(page), {
    between: async () => {
      await goToTab(page, "premiums");
      await page.waitForSelector("table.table tbody tr", { timeout: 15000 });
    },
  });
}

async function clickRateAllPlansOnce(page) {
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll("a.o-btn")).some(
        (b) =>
          (b.textContent || "").trim().toLowerCase() === "rate all plans" &&
          b.offsetParent !== null,
      ),
    { timeout: 15000 },
  );
  const handle = await page.evaluateHandle(() =>
    Array.from(document.querySelectorAll("a.o-btn")).find(
      (a) =>
        (a.textContent || "").replace(/\s+/g, " ").trim().toLowerCase() ===
          "rate all plans" && a.offsetParent !== null,
    ),
  );
  const el = handle.asElement();
  if (!el) throw new Error('Could not find "Rate All Plans"');
  await el.evaluate((a) => a.scrollIntoView({ block: "center" }));
  await el.click();
}

async function getPremiumRowStates(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("table.table tbody tr")).map(
      (row) => ({
        text: (row.innerText || "").replace(/\s+/g, " ").trim().slice(0, 150),
        buttons: Array.from(row.querySelectorAll("button, a.o-btn"))
          .filter((b) => b.offsetParent !== null)
          .map(
            (b) =>
              (b.textContent || "").trim() + (b.disabled ? " (disabled)" : ""),
          ),
      }),
    ),
  );
}

async function waitForRatingSettled(page, carriers = null, maxMs = 180000) {
  const start = Date.now();
  let lastSig = "";
  let stableCount = 0;
  while (Date.now() - start < maxMs) {
    await sleep(5000);
    for (const carrier of carriers || [null]) {
      if (await rowButton(page, SUMMARY_RE, { carrier, click: false }))
        return true;
    }
    const sig = JSON.stringify(await getPremiumRowStates(page).catch(() => []));
    stableCount = sig === lastSig ? stableCount + 1 : 0;
    lastSig = sig;
    if (Date.now() - start > 30000 && stableCount >= 4) return false;
  }
  return false;
}

const REVIEW_MODAL_SEL =
  '.modalbox__content, .modalbox, [role="dialog"], .sm-popup.is-active';

async function collectReviewWarnings(page, carrier = null) {
  const rowCount = await page.$$eval("table.table tbody tr", (r) => r.length);
  const warnings = new Set();
  for (let i = 0; i < rowCount; i++) {
    const opened = await page.evaluate(
      (idx, carrier) => {
        const row = document.querySelectorAll("table.table tbody tr")[idx];
        if (!row) return false;
        if (
          carrier &&
          !(row.innerText || "").toLowerCase().includes(carrier.toLowerCase())
        )
          return false;
        const btn = Array.from(
          row.querySelectorAll("button, a, .o-btn, span"),
        ).find(
          (b) =>
            /^\s*review\s*$/i.test(b.textContent || "") &&
            b.offsetParent !== null,
        );
        if (!btn) return false;
        btn.scrollIntoView({ block: "center" });
        btn.click();
        return true;
      },
      i,
      carrier,
    );
    if (!opened) continue;

    const found = await page
      .waitForFunction(
        (sel) =>
          Array.from(document.querySelectorAll(sel)).some(
            (m) =>
              m.getClientRects().length &&
              /review warnings/i.test(m.innerText || ""),
          ),
        { timeout: 10000 },
        REVIEW_MODAL_SEL,
      )
      .then(() => true)
      .catch(() => false);
    if (!found) continue;

    const lines = await page.evaluate((sel) => {
      const modal = Array.from(document.querySelectorAll(sel))
        .filter(
          (m) =>
            m.getClientRects().length &&
            /review warnings/i.test(m.innerText || ""),
        )
        .pop();
      if (!modal) return [];
      const links = Array.from(modal.querySelectorAll("a"))
        .map((a) => (a.textContent || "").trim())
        .filter(Boolean);
      if (links.length) return links;
      return (modal.innerText || "")
        .split("\n")
        .map((s) => s.trim())
        .filter(
          (s) =>
            s &&
            !/^(review warnings|this plan cannot be rated|.*requires:$|resolve warnings$|close$)/i.test(
              s,
            ),
        );
    }, REVIEW_MODAL_SEL);
    lines.forEach((l) => warnings.add(l));

    await page.evaluate((sel) => {
      const modal = Array.from(document.querySelectorAll(sel))
        .filter(
          (m) =>
            m.getClientRects().length &&
            /review warnings/i.test(m.innerText || ""),
        )
        .pop();
      const close =
        modal &&
        Array.from(modal.querySelectorAll("button, a")).find((b) =>
          /^\s*close\s*$/i.test(b.textContent || ""),
        );
      if (close) close.click();
    }, REVIEW_MODAL_SEL);
    await page
      .waitForFunction(
        (sel) =>
          !Array.from(document.querySelectorAll(sel)).some(
            (m) =>
              m.getClientRects().length &&
              /review warnings/i.test(m.innerText || ""),
          ),
        { timeout: 5000 },
        REVIEW_MODAL_SEL,
      )
      .catch(() => {});
    await sleep(500);
  }
  return Array.from(warnings);
}

// ─────────────────────────────────────────────────────────────
//  1.  INPUT DATA
// ─────────────────────────────────────────────────────────────

// SinglePoint login. Prefer n8n environment variables (SPR_USERNAME /
// SPR_PASSWORD). If env access is blocked on your instance, paste the
// values below — and rotate the password, it was stored in plain text.
const readEnv = (k) => {
  try {
    return (typeof $env !== "undefined" && $env && $env[k]) || "";
  } catch (_) {
    return "";
  }
};
const USERNAME = readEnv("SPR_USERNAME") || "agent1";
const PASSWORD = readEnv("SPR_PASSWORD") || "Singapore@2025";
if (PASSWORD === "REPLACE_WITH_SPR_PASSWORD")
  throw new Error(
    "SinglePoint password not configured (set SPR_PASSWORD or edit the script)",
  );

const B = $json.body || {};

const formId = String(B.form_id || "").toUpperCase();
const INSURANCE_TYPE =
  $json.type ||
  (formId.startsWith("AUTO")
    ? "auto"
    : formId.startsWith("HOME")
      ? "home"
      : formId.startsWith("DWELLING")
        ? "dwelling"
        : formId.startsWith("UMBRELLA")
          ? "umbrella"
          : "auto");

const licenseNo = String(B.d1_lic_num || "")
  .trim()
  .toUpperCase();
const firstName = String(B.d1_first || B.first_name || "").trim();
const lastName = String(B.d1_last || B.last_name || "").trim();
const dobRaw = String(B.d1_dob || "").trim();
const firstLicenseDate = String(B.d1_lic_date || "").trim();
const licenseState = String(B.d1_lic_state || "")
  .trim()
  .toUpperCase();
const vehicleVin = String(B.v1_vin || "").trim();
const vehicleYear = String(B.v1_year || "2016").trim();
const vehicleMake = String(B.v1_make || "Subaru").trim();
const vehicleModel = String(B.v1_model || "OUTBACK").trim();
const vehicleTrim = String(B.v1_trim || B.step_5_reg_type_1 || "").trim();
const vehicleBody = String(B.v1_body || "")
  .split("/")[0]
  .trim(); // "SUV / Crossover" → "SUV"
const DEFAULT_PRICE_NEW = "60000";
const vehiclePriceNew = String(
  B.v1_price_new || B.v1_price || B.v1_value || "",
).replace(/[^\d]/g, "");
const vehicleZip = String(B.v1_zip || "").trim();
const address1 = String(B.residential_address || "").trim();
const city = String(B.step_1_data?.city || B.city || "").trim();
const state = String(B.state || "")
  .trim()
  .toUpperCase();
const zip = String(B.zip || vehicleZip).trim();
const email = String(B.email || "").trim();
const agentCode = String(B.agent_code || $json.agent_code || "")
  .trim()
  .toUpperCase();
const IS_JRN = agentCode === "JRN";
const locationZip = vehicleZip || zip;

// Gender / marital as SinglePoint labels
const genderText =
  { male: "Male", female: "Female", m: "Male", f: "Female" }[
    String(B.d1_gender || "")
      .trim()
      .toLowerCase()
  ] || "";
const maritalText = (() => {
  const m = String(B.d1_marital || "")
    .trim()
    .toLowerCase();
  if (!m) return "";
  if (/not married|single|never/.test(m)) return "Single";
  if (/divorc/.test(m)) return "Divorced";
  if (/widow/.test(m)) return "Widowed";
  if (/separat/.test(m)) return "Separated";
  if (/partner|civil/.test(m)) return "Domestic Partner";
  if (/married/.test(m)) return "Married";
  return "Single";
})();

// Prior carrier / expiration from the form, with safe fallbacks
const priorCarrier = String(B.prior_carrier || "").trim();
const priorExpRaw = String(B.prior_exp || "").trim();

function deriveFirstLicenseDate(dob) {
  const m = String(dob).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return "";
  const d = new Date(Number(m[1]) + 18, Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  const use = d > now ? now : d;
  return `${use.getFullYear()}-${String(use.getMonth() + 1).padStart(2, "0")}-${String(use.getDate()).padStart(2, "0")}`;
}
const effectiveFirstLicenseDate =
  firstLicenseDate || deriveFirstLicenseDate(dobRaw);
if (!firstLicenseDate)
  console.warn(
    `d1_lic_date missing — using derived First Licensed ${effectiveFirstLicenseDate}`,
  );

if (!licenseNo) throw new Error("Missing d1_lic_num in input JSON");
if (!formatDateToMMDDYYYY(dobRaw))
  throw new Error(`Missing/invalid d1_dob "${dobRaw}"`);

// MA licences start with "S" (S + 8 digits, or "SA" + 7). Only those can
// use the RMV lookup; everything else (out-of-state) is entered manually.
const isRmvFlow =
  (!licenseState || licenseState === "MA") && /^S/.test(licenseNo);
console.log(
  `Licence ${licenseState} ${licenseNo} → ${isRmvFlow ? "RMV lookup" : "manual entry"} flow`,
);

// ─────────────────────────────────────────────────────────────
//  2.  LOGIN
// ─────────────────────────────────────────────────────────────

await $page.goto("https://apps.singlepointrating.com/webapps/sprapp/#/login", {
  waitUntil: "networkidle2",
  timeout: 30000,
});

const USER_SEL =
  'input[name="UserName" i], input#UserName, input[name="login" i], input[type="email"], form input[type="text"]';
const PASS_SEL = 'input[name="Password" i], input[type="password"]';

const loginState = await $page
  .waitForFunction(
    (u) => {
      if (document.querySelector(".sidebox .app-button-square"))
        return "loggedIn";
      const el = document.querySelector(u);
      if (el && (el.offsetParent || el.getClientRects().length)) return "form";
      return false;
    },
    { timeout: 45000, polling: 500 },
    USER_SEL,
  )
  .then((h) => h.jsonValue())
  .catch(() => null);

if (!loginState) {
  const debug = await $page
    .evaluate(() => ({ url: location.href, title: document.title }))
    .catch(() => ({}));
  throw new Error(
    `Login form not found after 45s. Page state: ${JSON.stringify(debug)}`,
  );
}

if (loginState === "form") {
  await $page.click(USER_SEL, { clickCount: 3 }).catch(() => {});
  await $page.type(USER_SEL, USERNAME, { delay: 30 });
  await $page.waitForSelector(PASS_SEL, { visible: true, timeout: 10000 });
  await $page.click(PASS_SEL, { clickCount: 3 }).catch(() => {});
  await $page.type(PASS_SEL, PASSWORD, { delay: 30 });
  await Promise.all([
    $page.click("button.o-btn.o-btn--large"),
    $page
      .waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 })
      .catch(() => {}),
  ]);
} else {
  console.log("Existing session detected — skipping login form.");
}

await $page.waitForSelector(".sidebox", { timeout: 15000 }).catch(() => {});
await $page.waitForSelector(".sidebox .app-button-square", { timeout: 10000 });

// ─────────────────────────────────────────────────────────────
//  3.  SELECT INSURANCE TYPE
// ─────────────────────────────────────────────────────────────

const buttons = await $page.$$(".sidebox .app-button-square");
const typeMap = { auto: 0, home: 1, dwelling: 2, umbrella: 3 };
const btnIndex = typeMap[INSURANCE_TYPE.toLowerCase()];
if (btnIndex === undefined)
  throw new Error(`Unknown insurance type: ${INSURANCE_TYPE}`);
await buttons[btnIndex].click();
console.log(`Clicked insurance type: ${INSURANCE_TYPE}`);

await $page.waitForSelector(".sm-popup.is-active", { timeout: 30000 });
await sleep(1500);

// ─────────────────────────────────────────────────────────────
//  4.  DRIVER TAB
// ─────────────────────────────────────────────────────────────

if (isRmvFlow) {
  // ── 4A. RMV LOOKUP FLOW ──────────────────────────────────
  await $page.evaluate(() => {
    const container = document.querySelector(".sm-popup.is-active");
    if (!container) return;
    const btn = Array.from(container.querySelectorAll("button.o-btn")).find(
      (b) => (b.textContent || "").trim().includes("Use Rmv"),
    );
    if (btn) btn.click();
  });

  await $page.waitForSelector("#firstName0", { timeout: 30000 });
  await $page.type("#firstName0", firstName, { delay: 30 });
  await $page.type("#lastName0", lastName, { delay: 30 });
  await $page.type("#licenseNumber0", licenseNo, { delay: 30 });

  // RMV lookup DOB — same masked input, use the robust setter
  await $page.evaluate(() => {
    document
      .querySelectorAll("[data-rmv-dob]")
      .forEach((n) => n.removeAttribute("data-rmv-dob"));
    const el = document.querySelector("input.datepicker-input__input");
    if (el) el.setAttribute("data-rmv-dob", "1");
  });
  const rmvDobOk = await setDateInput(
    $page,
    "[data-rmv-dob]",
    formatDateToMMDDYYYY(dobRaw),
  );
  if (!rmvDobOk) console.warn("RMV lookup DOB did not stick");

  await $page.click('button[type="submit"].o-btn');
  await sleep(6000);

  const maxMs = 90000;
  const start = Date.now();
  let goClicked = false;
  while (Date.now() - start < maxMs) {
    goClicked = await $page.evaluate(() => {
      const anchors = Array.from(
        document.querySelectorAll("section.section a.o-btn"),
      );
      const target = anchors.find((a) =>
        /go\s*to\s*quote/i.test((a.textContent || "").trim()),
      );
      if (target && target.offsetParent !== null) {
        target.scrollIntoView({ block: "center" });
        target.click();
        return true;
      }
      return false;
    });
    if (goClicked) break;
    await sleep(1000);
  }
  if (!goClicked)
    throw new Error(`RMV lookup never returned "Go to Quote" for ${licenseNo}`);

  await $page
    .waitForSelector(".modalbox__content.u-width-500px", { timeout: 30000 })
    .catch(() => {});
  await sleep(1000);
  for (let attempt = 0; attempt < 2; attempt++) {
    const clicked = await $page.evaluate(() => {
      const modal = document.querySelector(".modalbox__content.u-width-500px");
      if (!modal) return false;
      const btn = Array.from(modal.querySelectorAll("button.o-btn")).find((b) =>
        (b.textContent || "").trim().toLowerCase().includes("go to quote"),
      );
      if (btn && btn.offsetParent !== null) {
        btn.scrollIntoView({ block: "center" });
        btn.click();
        return true;
      }
      return false;
    });
    if (clicked) break;
    await sleep(2000);
  }

  await $page.waitForSelector("#driverRelationshipToInsured", {
    timeout: 30000,
  });
  await sleep(4000); // let RMV data finish populating

  await $page.click("#driverRelationshipToInsured", { clickCount: 3 });
  await $page.keyboard.press("Backspace");
  await $page.keyboard.type("Insured", { delay: 100 });
  await $page.keyboard.press("Tab");

  await fillSdipIfEmpty($page);
  await verifyDriverTab($page);
} else {
  // ── 4B. MANUAL ENTRY FLOW (out-of-state licences) ────────
  await $page.evaluate(() => {
    const container = document.querySelector(".sm-popup.is-active");
    if (!container) return;
    const btn = Array.from(container.querySelectorAll("button.o-btn")).find(
      (b) => (b.textContent || "").trim().includes("Create Manually"),
    );
    if (btn) btn.click();
  });

  await $page.waitForSelector("#driverFirstName", { timeout: 15000 });
  await $page.type("#driverFirstName", firstName, { delay: 100 });
  await sleep(100);
  await $page.type("#driverLastName", lastName, { delay: 120 });
  await $page.keyboard.press("Tab");
  await sleep(800); // let the form settle before the masked DOB field

  const dobFormatted = formatDateToMMDDYYYY(dobRaw);
  const dobOk = await setDateInput($page, "#driverDateOfBirth", dobFormatted);
  if (!dobOk)
    console.warn(`Driver DOB did not stick (${dobFormatted}) — will re-check`);

  await $page.waitForSelector("#driverRelationshipToInsured", {
    timeout: 10000,
  });
  // Relationship must be Insured BEFORE the DOB is (re)entered so the app
  // copies driver 1's DOB to the client record.
  await syncInsuredDob($page);

  if (effectiveFirstLicenseDate) {
    await setDateInput(
      $page,
      "#driverFirstLicensed",
      formatDateToMMDDYYYY(effectiveFirstLicenseDate),
    );
  }

  await setTextInput($page, "#driverLicenseNumber", licenseNo);

  await $page.waitForSelector("#driverCurrentLicenseState", { timeout: 10000 });
  const lsVal = await fillSelectVerified(
    $page,
    "#driverCurrentLicenseState",
    licenseState,
  );
  if (!lsVal) console.warn(`Licence state "${licenseState}" did not stick`);

  await fillSdipIfEmpty($page);

  // Re-check DOB / First Licensed / gender / marital before leaving
  const driverProblems = await verifyDriverTab($page);
  if (driverProblems.includes("driver DOB")) {
    const diag = await describeTab($page, "drivers").catch((e) => e.message);
    throw new Error(
      `Driver DOB could not be set (${dobFormatted}). Quote: ${quoteUrl()} DIAGNOSTICS: ${JSON.stringify(diag)}`,
    );
  }

  // Client info: address + DOB
  await $page.waitForSelector(".aboutbox__title", { timeout: 10000 });
  await $page.evaluate(() => {
    const box = Array.from(document.querySelectorAll(".aboutbox")).find(
      (b) =>
        b.querySelector(".aboutbox__title")?.textContent.trim() === "Client:",
    );
    if (!box) throw new Error("Client box not found");
    const link = box.querySelector("a.aboutbox__link");
    if (link) {
      link.scrollIntoView({ block: "center" });
      link.click();
    }
  });

  await $page.waitForSelector("#clientInfoAddrAddr1_StreetAddress", {
    visible: true,
    timeout: 10000,
  });
  await sleep(500);
  await setTextInput(
    $page,
    "#clientInfoAddrAddr1_StreetAddress",
    address1 || city,
  );
  await setTextInput($page, "#clientInfoAddrCity_StreetAddress", city);

  await $page.click("#clientInfoAddrState_StreetAddress", { clickCount: 3 });
  await $page.keyboard.press("Backspace");
  await $page.keyboard.type(state, { delay: 100 });
  await $page.keyboard.press("Tab");

  await setTextInput($page, "#clientInfoAddrZip_StreetAddress", zip);

  const clientDobOk = await fillClientDobInOpenForm(
    $page,
    formatDateToMMDDYYYY(dobRaw),
  ).catch((e) => {
    console.warn("Client DOB fill failed:", e.message);
    return false;
  });

  await clickUpdateInfo($page);

  // If the client DOB didn't stick in the form, try once more via the box
  if (!clientDobOk) {
    console.warn("Client DOB not confirmed — retrying via Client box");
    await setClientDob($page, formatDateToMMDDYYYY(dobRaw)).catch(() => false);
  }
}

// ─────────────────────────────────────────────────────────────
//  5.  VEHICLES TAB  (vehicle 1 only — see note in result)
// ─────────────────────────────────────────────────────────────

await goToTab($page, "vehicles");

if (vehicleVin) {
  await $page.waitForSelector("#vehicleVin", { timeout: 10000 });
  await $page.click("#vehicleVin", { clickCount: 3 });
  await $page.keyboard.press("Backspace");
  await $page.keyboard.type(vehicleVin, { delay: 100 });
  await $page.keyboard.press("Tab");
  await sleep(3000); // VIN lookup fills year/make/model/trim
} else {
  await fillSelectLike($page, "#vehicleYear", vehicleYear);
  await fillSelectLike($page, "#vehicleMake", vehicleMake);
  await fillSelectLike($page, "#vehicleModel", vehicleModel);
  await sleep(700);
  if (vehicleTrim) {
    let trimPicked = await fillSelectLike($page, "#vehicleTrim", vehicleTrim);
    if (!trimPicked)
      trimPicked = await fillSelectLike($page, "#vehicleTrim", vehicleTrim);
    if (!trimPicked) await selectFirstAvailableOption($page, "#vehicleTrim");
  } else {
    const trimValue = await selectOptionPreferring(
      $page,
      "#vehicleTrim",
      vehicleBody,
    );
    if (!trimValue) console.warn("Trim still empty after selection attempts");
  }
}

// Garaging address — zip first, then city only if the zip lookup left it empty
await setTextInput($page, "#vehicleLocationAddress1", address1);
await ensureVehicleZip($page);
if (!(await hasValue($page, "#vehicleLocationCity"))) {
  await $page.click("#vehicleLocationCity", { clickCount: 3 });
  await $page.keyboard.press("Backspace");
  await $page.keyboard.type(city, { delay: 100 });
  await $page.keyboard.press("Tab");
  await sleep(800);
}
await ensureVehicleZip($page); // city autocomplete can wipe the zip

await setTextInput($page, "#vehicleAnnualMiles", "10000");
await sleep(500);

await ensureVehiclePrice($page).catch((e) =>
  console.warn("Price New / Value fill failed:", e.message),
);

// ─────────────────────────────────────────────────────────────
//  6.  OPTIONS TAB
// ─────────────────────────────────────────────────────────────

await $page.click('.tabs__list .tabs__item a[href*="options"]');
await $page.waitForSelector("#priorOrRenewingCarrier", {
  visible: true,
  timeout: 15000,
});
await $page.$eval("#priorOrRenewingCarrier", (el) =>
  el.scrollIntoView({ block: "center" }),
);
await sleep(500);

// 6-1. Prior carrier: form value if SinglePoint has it, else "Other"
let carrierSet = "";
if (priorCarrier && B.curr_insured !== "no") {
  carrierSet = await fillSelectVerified(
    $page,
    "#priorOrRenewingCarrier",
    priorCarrier,
    { attempts: 1 },
  );
}
if (!carrierSet)
  carrierSet = await fillSelectVerified(
    $page,
    "#priorOrRenewingCarrier",
    "Other",
  );
console.log(`Prior carrier = "${carrierSet}"`);

// 6-2. Prior expiration: form value if it's a future date, else today + 1 yr
const priorExpSel = (await $page.$("#priorPolicyExpirationDate"))
  ? "#priorPolicyExpirationDate"
  : "input.datepicker-input__input";
let expiryMMDDYYYY = "";
const pe = priorExpRaw.match(/^(\d{4})-(\d{2})-(\d{2})/);
if (
  pe &&
  new Date(+pe[1], +pe[2] - 1, +pe[3]) >= new Date(new Date().toDateString())
) {
  expiryMMDDYYYY = formatDateToMMDDYYYY(priorExpRaw);
} else {
  const ny = new Date();
  ny.setFullYear(ny.getFullYear() + 1);
  expiryMMDDYYYY = `${String(ny.getMonth() + 1).padStart(2, "0")}${String(ny.getDate()).padStart(2, "0")}${ny.getFullYear()}`;
}
if (!(await setDateInput($page, priorExpSel, expiryMMDDYYYY)))
  console.warn(`Prior expiration did not stick (${expiryMMDDYYYY})`);

// 6-3. Policy history
await fillPolicyHistory($page);
await sleep(1000);

// 6A. Required (red) option items
await handleRequiredOptions($page);

// ─────────────────────────────────────────────────────────────
//  7.  PREMIUMS TAB
// ─────────────────────────────────────────────────────────────

await $page.click('.tabs__list .tabs__item a[href*="premiums"]');
await $page.waitForSelector("table.table tbody tr", { timeout: 15000 });
await saveQuote($page);

// Known Review warnings → fix. Add a new entry whenever a run fails with
// "Unhandled review warnings".
const REVIEW_FIXERS = [
  {
    key: "firstLicensed",
    match: /first licensed date required/i,
    fix: async (page) => {
      if (!effectiveFirstLicenseDate) return false;
      await goToTab(page, "drivers");
      return setDateInput(
        page,
        "#driverFirstLicensed",
        formatDateToMMDDYYYY(effectiveFirstLicenseDate),
      );
    },
  },
  {
    key: "vehicleZip",
    match: /zip code not set/i,
    fix: async (page) => {
      await goToTab(page, "vehicles");
      return ensureVehicleZip(page);
    },
  },
  {
    key: "driverDob",
    match: /required date of birth for driver/i,
    fix: async (page) => {
      const dob = formatDateToMMDDYYYY(dobRaw);
      if (!dob) return false;
      await goToTab(page, "drivers");
      return setDateInput(page, "#driverDateOfBirth", dob);
    },
  },
  {
    key: "clientDob",
    match: /required date of birth for client/i,
    fix: async (page) => {
      const dob = formatDateToMMDDYYYY(dobRaw);
      if (!dob) return false;
      // The warning link in SinglePoint points at #driverDateOfBirth: the
      // client DOB comes from the Insured driver. Re-select Insured and
      // re-enter the DOB with real keystrokes so the app syncs it.
      await goToTab(page, "drivers");
      await page.waitForSelector("#driverDateOfBirth", {
        visible: true,
        timeout: 15000,
      });
      const ok = await syncInsuredDob(page);
      // Fallback: client info form, if this SinglePoint version has a DOB there
      if (!ok) return setClientDob(page, dob).catch(() => false);
      return ok;
    },
  },
  {
    key: "gender",
    match: /gender/i,
    fix: async (page) => {
      if (!genderText) return false;
      await goToTab(page, "drivers");
      return !!(await fillSelectVerified(page, "#driverGender", genderText));
    },
  },
  {
    key: "marital",
    match: /marital/i,
    fix: async (page) => {
      await goToTab(page, "drivers");
      return !!(
        (await fillSelectVerified(
          page,
          "#driverMaritalStatus",
          maritalText || "Single",
        )) || (await fillSelectVerified(page, "#driverMaritalStatus", "Single"))
      );
    },
  },
  {
    key: "vehiclePrice",
    match: /price new \/ value/i,
    fix: async (page) => {
      await goToTab(page, "vehicles");
      if (!vehicleVin) {
        const trim = await page
          .$eval("#vehicleTrim", (el) => (el.value || "").trim())
          .catch(() => "");
        if (!trim)
          await selectOptionPreferring(page, "#vehicleTrim", vehicleBody);
      }
      return ensureVehiclePrice(page);
    },
  },
  {
    key: "policyHistory",
    match:
      /policy history|years with current agency|years with (this|prior) carrier|lapsed days|prior bodily injury/i,
    fix: async (page) => {
      await goToTab(page, "options");
      await page
        .waitForSelector("#yearsWithCurrentAgency", { timeout: 15000 })
        .catch(() => {});
      return fillPolicyHistory(page);
    },
  },
  {
    key: "vehicleTrim",
    match: /invalid vin|body style not selected|symbols are required/i,
    fix: async (page) => {
      if (vehicleVin) return false;
      await goToTab(page, "vehicles");
      return !!(await selectOptionPreferring(
        page,
        "#vehicleTrim",
        vehicleBody,
      ));
    },
  },
];

const SUMMARY_PRIORITY = ["MAPFRE", "MAIP"];
const PREFERRED_CARRIER = "Arbella";
const MAX_RATE_ROUNDS = 8;
const fixAttempts = new Map(); // warning → times fixed
let summaryOpened = false;
let summaryCarrier = null;
let preferredResolveTried = false;
let emptyReviewRounds = 0;

// Each warning may be fixed up to 2 times (the app sometimes needs a
// re-save before a fixed field clears the warning).
async function applyReviewFixers(page, warnings) {
  const unhandled = [];
  const ranThisCall = new Map();
  for (const w of warnings) {
    const fixer = REVIEW_FIXERS.find((f) => f.match.test(w));
    if (!fixer) {
      unhandled.push(w);
      continue;
    }
    const n = fixAttempts.get(w) || 0;
    if (n >= 2) {
      unhandled.push(`${w} (still present after ${n} fixes)`);
      continue;
    }
    const key = fixer.key || fixer.match.source;
    let ok;
    if (ranThisCall.has(key)) {
      ok = ranThisCall.get(key);
    } else {
      ok = await fixer.fix(page).catch((e) => {
        console.warn(`Fixer failed for "${w}":`, e.message);
        return false;
      });
      ranThisCall.set(key, ok);
    }
    fixAttempts.set(w, n + 1);
    if (!ok)
      unhandled.push(`${w} (fix ran but field missing or value didn't stick)`);
  }
  return unhandled;
}

await clickRateAllPlans($page);
console.log("Rate All Plans clicked");
await waitForRatingSettled($page, IS_JRN ? ["MAIP"] : SUMMARY_PRIORITY);

if (IS_JRN) {
  const MAIP = "MAIP";
  for (let round = 1; round <= MAX_RATE_ROUNDS; round++) {
    if (await findAndOpenPlanSummary($page, MAIP)) {
      summaryOpened = true;
      summaryCarrier = MAIP;
      break;
    }
    if (await rowButton($page, RATE_RE, { carrier: MAIP })) {
      await waitForRatingSettled($page, [MAIP]);
      continue;
    }
    const maipInReview = await rowButton($page, REVIEW_RE, {
      carrier: MAIP,
      click: false,
    });
    if (!maipInReview) break;
    const warnings = await collectReviewWarnings($page, MAIP);
    console.log(`JRN: MAIP review warnings (round ${round}):`, warnings);
    const unhandled = warnings.length
      ? await applyReviewFixers($page, warnings)
      : ["(no warnings found)"];
    if (unhandled.length) break;
    await goToTab($page, "premiums");
    await $page.waitForSelector("table.table tbody tr", { timeout: 15000 });
    await saveQuote($page);
    await clickRateAllPlans($page).catch(() => {});
    await waitForRatingSettled($page, [MAIP]);
  }
}

for (let round = 1; round <= MAX_RATE_ROUNDS && !summaryOpened; round++) {
  for (const carrier of SUMMARY_PRIORITY) {
    if (await findAndOpenPlanSummary($page, carrier)) {
      summaryOpened = true;
      summaryCarrier = carrier;
      break;
    }
  }
  if (summaryOpened) break;
  if (await findAndOpenPlanSummary($page)) {
    summaryOpened = true;
    break;
  }

  if (await rowButton($page, RATE_RE, { carrier: PREFERRED_CARRIER })) {
    console.log(`Rating ${PREFERRED_CARRIER} (round ${round})`);
    await waitForRatingSettled($page, [PREFERRED_CARRIER]);
    continue;
  }

  const preferredInReview = await rowButton($page, REVIEW_RE, {
    carrier: PREFERRED_CARRIER,
    click: false,
  });
  if (
    (!preferredInReview || preferredResolveTried) &&
    (await rowButton($page, RATE_RE, { excludeCarrier: PREFERRED_CARRIER }))
  ) {
    await waitForRatingSettled($page);
    continue;
  }

  const reviewTarget =
    preferredInReview && !preferredResolveTried ? PREFERRED_CARRIER : null;
  if (preferredInReview) preferredResolveTried = true;
  const warnings = await collectReviewWarnings($page, reviewTarget);
  console.log(
    `Review warnings for ${reviewTarget || "all plans"} (round ${round}):`,
    warnings,
  );

  if (!warnings.length) {
    emptyReviewRounds++;
    if (emptyReviewRounds <= 2) {
      await goToTab($page, "premiums");
      await $page
        .waitForSelector("table.table tbody tr", { timeout: 15000 })
        .catch(() => {});
      await clickRateAllPlans($page).catch((e) =>
        console.warn("Re-rate failed:", e.message),
      );
      await waitForRatingSettled($page);
      continue;
    }
    const states = await getPremiumRowStates($page).catch(() => []);
    throw new Error(
      `No 'View Plan Summary' and no Review warnings found. Quote: ${quoteUrl()} Row states: ${JSON.stringify(states)}`,
    );
  }

  const unhandled = await applyReviewFixers($page, warnings);

  if (unhandled.length) {
    const diag = {
      drivers: await describeTab($page, "drivers").catch((e) => e.message),
      vehicles: await describeTab($page, "vehicles").catch((e) => e.message),
    };
    throw new Error(
      `Unhandled review warnings — add a fixer in REVIEW_FIXERS: ${JSON.stringify(unhandled)}\n` +
        `Quote: ${quoteUrl()}\nDIAGNOSTICS: ${JSON.stringify(diag)}`,
    );
  }

  // Persist fixes, then re-rate so fixed plans can move off "Review"
  await goToTab($page, "premiums");
  await $page.waitForSelector("table.table tbody tr", { timeout: 15000 });
  await saveQuote($page);
  await clickRateAllPlans($page).catch((e) =>
    console.warn("Re-rate failed:", e.message),
  );
  await waitForRatingSettled($page);
}

if (!summaryOpened) {
  const states = await getPremiumRowStates($page).catch(() => []);
  throw new Error(
    `No 'View Plan Summary' after ${MAX_RATE_ROUNDS} rate rounds. Quote: ${quoteUrl()} Row states: ${JSON.stringify(states)}`,
  );
}
await sleep(3000);

// ─────────────────────────────────────────────────────────────
//  8.  CAPTURE PDF — intercept Blob created by "Print Long Proposal"
// ─────────────────────────────────────────────────────────────

const BLOB_HOOK = () => {
  (function () {
    if (window.__pdfQueues__) return;
    const origCreate = URL.createObjectURL.bind(URL);
    Object.defineProperty(window, "__pdfQueues__", {
      value: [],
      writable: false,
      configurable: false,
      enumerable: false,
    });
    URL.createObjectURL = function (blob) {
      try {
        if (blob && typeof blob.type === "string" && /pdf/i.test(blob.type)) {
          const r = new FileReader();
          r.onload = () => {
            try {
              window.__pdfQueues__.push(Array.from(new Uint8Array(r.result)));
            } catch (_) {}
          };
          r.readAsArrayBuffer(blob);
        }
      } catch (_) {}
      return origCreate(blob);
    };
  })();
};

if ($page.evaluateOnNewDocument) {
  await $page.evaluateOnNewDocument(BLOB_HOOK).catch(() => {});
}
await $page.evaluate(BLOB_HOOK).catch(() => {});

async function pullFrom(pg) {
  try {
    const arrays = await pg.evaluate(() =>
      Array.isArray(window.__pdfQueues__) ? window.__pdfQueues__ : [],
    );
    if (!arrays || !arrays.length) return [];
    return arrays.map((a) => Buffer.from(Uint8Array.from(a)));
  } catch (_) {
    return [];
  }
}

async function ensurePrintLauncher() {
  const visible = () =>
    $page
      .waitForSelector("#tooltipLauncherPrint", { timeout: 15000 })
      .then(() => true)
      .catch(() => false);
  if (await visible()) return;
  console.warn("#tooltipLauncherPrint not visible — re-opening plan summary");
  await $page.keyboard.press("Escape").catch(() => {});
  await goToTab($page, "premiums").catch(() => {});
  await $page
    .waitForSelector("table.table tbody tr", { timeout: 15000 })
    .catch(() => {});
  const reopened =
    (await findAndOpenPlanSummary($page, summaryCarrier).catch(() => false)) ||
    (await findAndOpenPlanSummary($page).catch(() => false));
  if (!reopened) throw new Error("No 'View plan summary' button to re-open");
  await sleep(3000);
  if (!(await visible()))
    throw new Error("Plan summary opened but print launcher never appeared");
}

async function openPrintMenu() {
  const hasProposalLink = () =>
    $page
      .evaluate(() =>
        Array.from(
          document.querySelectorAll(".tooltip__menu a, .tooltip__menu-link"),
        ).some((a) => /Print\s*Long\s*Proposal/i.test(a.textContent || "")),
      )
      .catch(() => false);

  for (let i = 1; i <= 3; i++) {
    if (await hasProposalLink()) return;
    if (i === 1) {
      await $page.$eval("#tooltipLauncherPrint", (el) => {
        el.scrollIntoView({ block: "center" });
        el.click();
      });
    } else {
      const h = await $page.$("#tooltipLauncherPrint");
      const box = h && (await h.boundingBox());
      if (box)
        await $page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
    const appeared = await $page
      .waitForFunction(
        () =>
          Array.from(
            document.querySelectorAll(".tooltip__menu a, .tooltip__menu-link"),
          ).some((a) => /Print\s*Long\s*Proposal/i.test(a.textContent || "")),
        { timeout: 6000 },
      )
      .then(() => true)
      .catch(() => false);
    if (appeared) return;
    console.warn(`Print menu didn't open (click ${i}/3)`);
  }
  throw new Error("Print menu (Print Long Proposal) never opened");
}

async function capturePdfOnce() {
  await ensurePrintLauncher();
  await $page.evaluate(BLOB_HOOK).catch(() => {});
  await $page
    .evaluate(() => {
      if (Array.isArray(window.__pdfQueues__)) window.__pdfQueues__.length = 0;
    })
    .catch(() => {});

  const sniffed = [];
  const sniff = async (resp) => {
    try {
      const headers = resp.headers() || {};
      const ct = (headers["content-type"] || "").toLowerCase();
      const cd = (headers["content-disposition"] || "").toLowerCase();
      if (
        !ct.includes("pdf") &&
        !cd.includes(".pdf") &&
        !ct.includes("octet-stream")
      )
        return;
      const buf = await (resp.buffer
        ? resp.buffer()
        : Buffer.from(await resp.arrayBuffer()));
      if (buf && buf.length && buf.slice(0, 5).toString("ascii") === "%PDF-")
        sniffed.push(buf);
    } catch (_) {}
  };
  $page.on("response", sniff);

  let newTab = null;
  const onPopup = async (p) => {
    newTab = p;
    try {
      p.on("response", sniff);
      if (p.evaluateOnNewDocument) await p.evaluateOnNewDocument(BLOB_HOOK);
      await p.evaluate(BLOB_HOOK).catch(() => {});
    } catch (_) {}
  };
  $page.on("popup", onPopup);

  try {
    await openPrintMenu();
    const clickedProposal = await $page.evaluate(() => {
      const target = Array.from(
        document.querySelectorAll(".tooltip__menu a, .tooltip__menu-link"),
      ).find((a) =>
        /Print\s*Long\s*Proposal/i.test(
          (a.innerText || a.textContent || "").trim(),
        ),
      );
      if (!target) return false;
      target.scrollIntoView({ block: "center" });
      target.click();
      return true;
    });
    if (!clickedProposal)
      throw new Error('Could not find "Print Long Proposal"');

    let bufs = [];
    for (let waited = 0; waited < 30000 && !bufs.length; waited += 1000) {
      await sleep(1000);
      bufs = [
        ...(await pullFrom($page)),
        ...(newTab ? await pullFrom(newTab) : []),
        ...sniffed,
      ].filter((b) => b && b.length);
    }
    if (!bufs.length)
      throw new Error(
        "No PDF captured. The app may be rendering print-HTML instead of a PDF blob.",
      );
    bufs.sort((a, b) => b.length - a.length);
    return bufs[0];
  } finally {
    $page.off("response", sniff);
    $page.off("popup", onPopup);
    if (newTab) await newTab.close().catch(() => {});
    await $page.bringToFront().catch(() => {});
  }
}

let pdfBuffer;
try {
  pdfBuffer = await retry("Capture PDF", capturePdfOnce, {
    attempts: 3,
    delay: 3000,
    between: () => $page.keyboard.press("Escape"),
  });
} catch (e) {
  throw new Error(`${e.message} Quote: ${quoteUrl()}`);
}

const now = new Date();
const fileDate = [
  String(now.getMonth() + 1).padStart(2, "0"),
  String(now.getDate()).padStart(2, "0"),
  now.getFullYear(),
].join("");
const fileName = `${fileDate} ${firstName} ${lastName} auto insurance quote.pdf`;

// ─────────────────────────────────────────────────────────────
//  9.  RETURN RESULT
// ─────────────────────────────────────────────────────────────

const vehicleCount = Number(B.vehicle_count || 1);
const addlDrivers = Number(B.addl_driver_count || 0);

return [
  {
    json: {
      message: "PDF captured successfully",
      email,
      licenseNo,
      fileName,
      quoteUrl: quoteUrl(),
      carrier: summaryCarrier || "first rated plan",
      flow: isRmvFlow ? "rmv" : "manual",
      notQuoted: {
        extraVehicles: Math.max(0, vehicleCount - 1),
        additionalDrivers: addlDrivers,
      },
    },
    binary: {
      proposal: {
        data: pdfBuffer.toString("base64"),
        mimeType: "application/pdf",
        fileName,
      },
    },
  },
];
