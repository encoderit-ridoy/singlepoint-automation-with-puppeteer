// ============================================================
//  SinglePoint Auto-Insurance Quote — n8n Puppeteer Node
//  Full script: login → driver → vehicles → options → premiums → PDF
//  Compatible with n8n "Execute Browser" / Puppeteer node.
//  No external packages required.
//
//  CHANGE LOG (this revision):
//   - vehicleTrim now falls back to "first available option" instead of
//     typing an empty string when step_5_reg_type_1 / v1_trim is missing.
//   - Premiums flow rewritten to match the real DOM: after "Rate All
//     Plans", wait ~30s, then scan the table for the first ENABLED
//     "View plan summary" button and click it. MAIP (CAR) / MAPFRE never
//     expose that button (they use a "Review" flow instead), which is why
//     the old MAIP-specific logic dead-ended and caused the
//     #tooltipLauncherPrint timeout.
//   - #tooltipLauncherPrint wait now retries opening the plan summary up
//     to 3x with a diagnostic screenshot + clear error on final failure.
// ============================================================

// ─────────────────────────────────────────────────────────────
//  0.  TOP-LEVEL HELPERS  (available everywhere in this script)
// ─────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function formatDateToMMDDYYYY(dateStr) {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const year = date.getFullYear();
  return `${month}${day}${year}`;
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
  // remove readonly if any
  await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (el) el.removeAttribute("readonly");
  }, inputSel);
  await page.keyboard.press("ArrowDown").catch(() => {});
  await page.keyboard.press("Space").catch(() => {});
  // click any toggle/caret button inside the same wrapper
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

// Try to click an option by text — first relative to the input, then globally
async function pickByTextRobust(page, inputSel, text) {
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

  // 1) near the input
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

  // 2) global (overlays / portals)
  const global_ = await page.evaluate(
    (target, sels) => {
      const norm = (x) => (x || "").trim().toLowerCase();
      for (const sel of sels) {
        const vis = Array.from(document.querySelectorAll(sel)).filter(
          (n) => !!(n.offsetParent || n.getClientRects().length),
        );
        const hit =
          vis.find((n) => norm(n.textContent) === norm(target)) ||
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

  // 3) keyboard fallback
  try {
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    return true;
  } catch (_) {}

  return false;
}

// Full select-like fill: open → clear → type → pick → tab
async function fillSelectLike(page, inputSel, value) {
  await openSelectLike(page, inputSel);
  await page.click(inputSel, { clickCount: 3 }).catch(() => {});
  for (let i = 0; i < 8; i++) {
    try {
      await page.keyboard.press("Backspace");
    } catch (_) {}
  }
  await page.type(inputSel, value, { delay: 70 });
  await sleep(400);
  const ok = await pickByTextRobust(page, inputSel, value);
  await page.keyboard.press("Tab").catch(() => {});
  return ok;
}

// NEW: when we don't have a specific value to type (e.g. trim missing from
// the webhook payload), open the dropdown and just take whatever the first
// visible option is, instead of typing an empty string and matching garbage.
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

// Robustly fill an autocomplete that is just a number (e.g. yearsWithThisCarrier)
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

  let current = await page
    .$eval(sel, (el) => el.value || el.getAttribute("value") || "")
    .catch(() => "");

  if (current !== String(value)) {
    // try dropdown click
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

    // force-set as last resort
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

// Click a custom checkbox and ensure it ends up checked
async function ensureChecked(page, baseId) {
  const SEL_ITEM = `#${baseId}`;
  const SEL_INPUT = `#${baseId}_checkbox`;
  const SEL_ICON = `#${baseId}_checkbox + i.o-btn.o-btn--checkbox`;

  await page.waitForSelector(SEL_ITEM, { timeout: 15000 });
  await page.$eval(SEL_ITEM, (el) =>
    el.scrollIntoView({ block: "center", inline: "center" }),
  );

  // try icon click first
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
}

// Pick a radio in a modal by text regex, fallback to first/last
async function pickModalRadio(
  page,
  textRegex,
  fallback /* "first" | "last" */,
) {
  await page.waitForSelector(
    'label.o-checkable input[name="parsedItemOption"]',
    {
      timeout: 15000,
    },
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

// Click the Save button inside any currently-open modal
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
  // wait for modal to close
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

// NEW: scan the premiums table for the first ENABLED "View plan summary"
// button and click it. Confirmed from the live DOM:
//   - Carriers like Progressive / Arbella get a $ premium tag + a
//     "View plan summary" button once rated.
//   - MAIP (CAR) and MAPFRE never get that button at all — they get a
//     "Review" button instead (manual underwriting flow, out of scope
//     for this automation).
//   - Travelers (or others) that fail rating get an "Error" / "Review
//     Error" button, also not a summary.
// So there's no such thing as "waiting for MAIP to rate" — we just need
// to wait for ANY carrier row to finish and expose "View plan summary".
async function findAndOpenPlanSummary(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("table.table tbody tr"));
    for (const row of rows) {
      const btn = Array.from(row.querySelectorAll("button")).find((b) =>
        /^\s*view\s*plan\s*summary\s*$/i.test((b.textContent || "").trim()),
      );
      if (btn && btn.offsetParent !== null && !btn.disabled) {
        btn.scrollIntoView({ block: "center" });
        btn.click();
        return true;
      }
    }
    return false;
  });
}

// ─────────────────────────────────────────────────────────────
//  1.  INPUT DATA
// ─────────────────────────────────────────────────────────────

const USERNAME = "agent1";
const PASSWORD = "Singapore@2025";

// NOTE: the webhook payload has no top-level "type" field (fields live
// under $json.body). $json.type will always be undefined, so this used to
// silently fall back to "auto" every time — correct for this form by
// coincidence, not by design. Deriving from form_id makes it correct on
// purpose and safe if other form_ids ever get routed through this node.
const formId = String($json.body?.form_id || "").toUpperCase();
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

const licenseNo = String($json.body?.d1_lic_num || "").trim();
const firstName = String($json.body?.first_name || "").trim();
const lastName = String($json.body?.last_name || "").trim();
const dobRaw = String($json.body?.d1_dob || "").trim();
const firstLicenseDate = String($json.body?.d1_lic_date || "").trim();
const licenseState = String($json.body?.d1_lic_state || "").trim();
const vehicleVin = String($json.body?.v1_vin || "").trim();
const vehicleYear = String($json.body?.v1_year || "2016").trim();
const vehicleMake = String($json.body?.v1_make || "Subaru").trim();
const vehicleModel = String($json.body?.v1_model || "OUTBACK").trim();
// NOTE: the current webhook payload does not send step_5_reg_type_1 at all
// (checked against a live sample) — it only sends v1_year/v1_make/v1_model.
// v1_trim is included as an alt name in case the form is updated later.
// If both are missing, vehicleTrim stays "" and the Vehicles-tab logic
// below now falls back to selecting the first available trim option
// instead of typing an empty string into the autocomplete.
const vehicleTrim = String(
  $json.body?.v1_trim || $json.body?.step_5_reg_type_1 || "",
).trim();
const vehicleZip = String($json.body?.v1_zip || "").trim();
const address1 = String($json.body?.residential_address || "").trim();
const city = String(
  $json.body?.step_1_data?.city || $json.body?.city || "",
).trim();
const state = String($json.body?.state || "").trim();
const zip = String($json.body?.zip || vehicleZip).trim();
const email = String($json.body?.email || "").trim();

if (!licenseNo) throw new Error("Missing d1_lic_num in input JSON");

// ─────────────────────────────────────────────────────────────
//  2.  LOGIN
// ─────────────────────────────────────────────────────────────

await $page.goto("https://apps.singlepointrating.com/webapps/sprapp/#/login", {
  waitUntil: "networkidle2",
  timeout: 30000,
});

await $page.waitForSelector('input[name="UserName"]', { timeout: 15000 });
await $page.click('input[name="UserName"]', { clickCount: 3 }).catch(() => {});
await $page.type('input[name="UserName"]', USERNAME, { delay: 30 });

await $page.waitForSelector('input[name="Password"]', { timeout: 10000 });
await $page.click('input[name="Password"]', { clickCount: 3 }).catch(() => {});
await $page.type('input[name="Password"]', PASSWORD, { delay: 30 });

await Promise.all([
  $page.click("button.o-btn.o-btn--large"),
  $page
    .waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 })
    .catch(() => {}),
]);

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

await sleep(10000); // allow page to fully load after type selection

// ─────────────────────────────────────────────────────────────
//  4.  DRIVER TAB — branch on license prefix
// ─────────────────────────────────────────────────────────────

const isRmvFlow = licenseNo.toUpperCase().startsWith("S");

if (isRmvFlow) {
  // ── 4A. RMV LOOKUP FLOW ──────────────────────────────────
  await $page.waitForSelector(".sm-popup.is-active", { timeout: 30000 });
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

  const dobFormatted = formatDateToMMDDYYYY(dobRaw);
  await $page.click("input.datepicker-input__input", { clickCount: 3 });
  await $page.keyboard.type(dobFormatted, { delay: 150 });
  await $page.keyboard.press("Tab");

  // submit RMV lookup
  await $page.click('button[type="submit"].o-btn');
  await sleep(6000);

  // poll up to 90s for "Go to Quote" button then click it
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
    if (goClicked) {
      console.log('Clicked "Go To Quote"');
      break;
    }
    await sleep(1000);
  }

  await sleep(1000);

  // handle the confirmation modal if it appears
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
    if (clicked) {
      console.log('Clicked "Go To Quote" in modal');
      break;
    }
    await sleep(2000);
  }

  await sleep(10000);

  // driver relationship & first licensed (post-RMV page)
  await $page.waitForSelector("#driverRelationshipToInsured", {
    timeout: 15000,
  });
  await $page.click("#driverRelationshipToInsured", { clickCount: 3 });
  await $page.keyboard.press("Backspace");
  await $page.keyboard.type("Insured", { delay: 100 });
  await $page.keyboard.press("Tab");

  if (firstLicenseDate) {
    await $page.type(
      "#driverFirstLicensed",
      formatDateToMMDDYYYY(firstLicenseDate),
      { delay: 100 },
    );
    await $page.keyboard.press("Tab");
  }

  await $page.waitForSelector("#driverSdip", { visible: true, timeout: 5000 });
  await $page.type("#driverSdip", "00", { delay: 100 });
  await $page.keyboard.press("Tab");
  await sleep(500);
  // Take a screenshot after the page has loaded
  const sss1 = "C:/InsuranceQuote/screenshot1.png";
  await $page.screenshot({ path: sss1, fullPage: true });
} else {
  // ── 4B. MANUAL ENTRY FLOW ────────────────────────────────
  await $page.waitForSelector(".sm-popup.is-active", { timeout: 30000 });
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
  await $page.type("#driverLastName", lastName, { delay: 150 });
  await sleep(100);

  const dobFormatted = formatDateToMMDDYYYY(dobRaw);
  await $page.click("#driverDateOfBirth", { clickCount: 3 });
  await $page.keyboard.type(dobFormatted, { delay: 150 });
  await $page.keyboard.press("Tab");

  await $page.waitForSelector("#driverRelationshipToInsured", {
    timeout: 10000,
  });
  await $page.click("#driverRelationshipToInsured", { clickCount: 3 });
  await $page.keyboard.press("Backspace");
  await $page.keyboard.type("Insured", { delay: 100 });
  await $page.keyboard.press("Tab");

  if (firstLicenseDate) {
    await $page.type(
      "#driverFirstLicensed",
      formatDateToMMDDYYYY(firstLicenseDate),
      { delay: 100 },
    );
    await $page.keyboard.press("Tab");
  }

  await $page.focus("#driverLicenseNumber");
  await $page.type("#driverLicenseNumber", licenseNo, { delay: 150 });
  await $page.keyboard.press("Tab");

  await $page.waitForSelector("#driverCurrentLicenseState", { timeout: 10000 });
  await $page.click("#driverCurrentLicenseState", { clickCount: 3 });
  await $page.keyboard.press("Backspace");
  await $page.keyboard.type(licenseState, { delay: 100 });
  await $page.keyboard.press("Tab");

  await $page.waitForSelector("#driverSdip", { visible: true, timeout: 5000 });
  await $page.type("#driverSdip", "00", { delay: 100 });
  await $page.keyboard.press("Tab");
  await sleep(500);

  // Update client address info
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
    timeout: 10000,
  });
  await $page.click("#clientInfoAddrAddr1_StreetAddress", { clickCount: 3 });
  await $page.keyboard.press("Backspace");
  await $page.keyboard.type(address1 || city, { delay: 100 });

  await $page.waitForSelector("#clientInfoAddrCity_StreetAddress", {
    timeout: 10000,
  });
  await $page.click("#clientInfoAddrCity_StreetAddress", { clickCount: 3 });
  await $page.keyboard.press("Backspace");
  await $page.keyboard.type(city, { delay: 100 });

  await $page.waitForSelector("#clientInfoAddrState_StreetAddress", {
    timeout: 10000,
  });
  await $page.click("#clientInfoAddrState_StreetAddress", { clickCount: 3 });
  await $page.keyboard.press("Backspace");
  await $page.keyboard.type(state, { delay: 100 });
  await $page.keyboard.press("Tab");

  await $page.waitForSelector("#clientInfoAddrZip_StreetAddress", {
    timeout: 10000,
  });
  await $page.click("#clientInfoAddrZip_StreetAddress", { clickCount: 3 });
  await $page.keyboard.press("Backspace");
  await $page.keyboard.type(zip, { delay: 100 });

  await $page.waitForSelector("button.o-btn", {
    visible: true,
    timeout: 10000,
  });
  await $page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button.o-btn")).find(
      (b) => b.textContent.trim() === "Update info",
    );
    if (!btn) throw new Error("Update info button not found");
    btn.scrollIntoView({ block: "center" });
    btn.click();
  });
  await sleep(5000);
}

// ─────────────────────────────────────────────────────────────
//  5.  VEHICLES TAB
// ─────────────────────────────────────────────────────────────

await $page.click('.tabs__list .tabs__item a[href*="vehicles"]');
await sleep(1000);

if (vehicleVin) {
  await $page.waitForSelector("#vehicleVin", { timeout: 10000 });
  await $page.click("#vehicleVin", { clickCount: 3 });
  await $page.keyboard.press("Backspace");
  await $page.keyboard.type(vehicleVin, { delay: 100 });
  await $page.keyboard.press("Tab");
  await sleep(500);
} else {
  // Year → Make → Model → Trim (select-like dropdowns)
  await fillSelectLike($page, "#vehicleYear", vehicleYear);
  await fillSelectLike($page, "#vehicleMake", vehicleMake);
  await fillSelectLike($page, "#vehicleModel", vehicleModel);
  await sleep(700);

  // Trim: only try to match by name if we actually have a value. If the
  // webhook didn't send one (current form doesn't), pick the first
  // available option instead of typing "" — that was leaving the field in
  // an inconsistent state that could break rating downstream.
  if (vehicleTrim) {
    let trimPicked = await fillSelectLike($page, "#vehicleTrim", vehicleTrim);
    if (!trimPicked) {
      await sleep(800);
      trimPicked = await fillSelectLike($page, "#vehicleTrim", vehicleTrim);
    }
    if (!trimPicked) {
      console.warn(
        "Could not select trim by name, falling back to first available option:",
        vehicleTrim,
      );
      await selectFirstAvailableOption($page, "#vehicleTrim");
    }
  } else {
    console.warn(
      "No trim value supplied by webhook (v1_trim / step_5_reg_type_1 missing) — selecting first available trim option.",
    );
    await selectFirstAvailableOption($page, "#vehicleTrim");
  }
}

// Vehicle location
await $page.waitForSelector("#vehicleLocationAddress1", { timeout: 10000 });
await $page.click("#vehicleLocationAddress1", { clickCount: 3 });
await $page.keyboard.press("Backspace");
await $page.keyboard.type(address1, { delay: 100 });

await $page.waitForSelector("#vehicleLocationCity", { timeout: 10000 });
await $page.click("#vehicleLocationCity", { clickCount: 3 });
await $page.keyboard.press("Backspace");
await $page.keyboard.type(city, { delay: 100 });

await $page.waitForSelector("#vehicleLocationZip", { timeout: 10000 });
await $page.click("#vehicleLocationZip", { clickCount: 3 });
await $page.keyboard.press("Backspace");
await $page.keyboard.type(vehicleZip, { delay: 100 });
await $page.evaluate((v) => {
  const input = document.querySelector("#vehicleLocationZip");
  if (!input) return;
  input.value = v;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}, vehicleZip);

await $page.waitForSelector("#vehicleAnnualMiles", { timeout: 10000 });
await $page.click("#vehicleAnnualMiles", { clickCount: 3 });
await $page.keyboard.press("Backspace");
await $page.keyboard.type("10000", { delay: 100 });
await $page.keyboard.press("Tab");
await sleep(1000);
// Take a screenshot after the page has loaded
const sss2 = "C:/InsuranceQuote/screenshot2.png";
await $page.screenshot({ path: sss2, fullPage: true });
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

// 6-1. Prior carrier
await fillSelectLike($page, "#priorOrRenewingCarrier", "Other");

// 6-2. Prior expiry date (1 year from today)
const nextYear = new Date();
nextYear.setFullYear(nextYear.getFullYear() + 1);
const expiryMMDDYYYY = formatDateToMMDDYYYY(
  `${String(nextYear.getMonth() + 1).padStart(2, "0")}/${String(nextYear.getDate()).padStart(2, "0")}/${nextYear.getFullYear()}`,
);
if (expiryMMDDYYYY) {
  await $page.waitForSelector("input.datepicker-input__input", {
    visible: true,
    timeout: 10000,
  });
  await $page
    .click("input.datepicker-input__input", { clickCount: 3 })
    .catch(() => {});
  for (let i = 0; i < 12; i++) {
    try {
      await $page.keyboard.press("Backspace");
    } catch (_) {}
  }
  await $page.keyboard.type(expiryMMDDYYYY, { delay: 120 });
  await $page.keyboard.press("Tab");
}

// 6-3. Years with this carrier (6)
await fillNumericAutocomplete($page, "#yearsWithThisCarrier", "6");

// 6-4. Years with current agency (6)
await $page.waitForSelector("#yearsWithCurrentAgency", { timeout: 10000 });
await $page.click("#yearsWithCurrentAgency", { clickCount: 3 });
await $page.keyboard.press("Backspace");
await $page.keyboard.type("6", { delay: 100 });
await $page.keyboard.press("Tab");

// 6-5. Lapsed days last 12 months (0)
await $page.click("#lapsedDaysLast12Months", { clickCount: 3 });
await $page.keyboard.press("Backspace");
await $page.keyboard.type("0", { delay: 100 });
await $page.keyboard.press("Tab");

// 6-6. Prior bodily injury limits
await $page.click("#priorBodilyInjurylimits", { clickCount: 3 });
await $page.keyboard.press("Backspace");
await $page.keyboard.type("100/300", { delay: 100 });
await $page.keyboard.press("Tab");
await sleep(1000);

// ── 6A. MAPFRE — Length of Time for Continuous Coverage ──
await ensureChecked(
  $page,
  "BSC-AUTO-002400_MAPFRELengthofTimeforContinuousCoverage",
);
await pickModalRadio($page, /36\s*\+\s*months?/, "last");
await saveModal($page);

// ── 6B. Travelers — Continuous Insurance ─────────────────
await ensureChecked($page, "BSC-AUTO-002195_TravelersContinuousInsurance");
await pickModalRadio($page, /less\s+than\s+3\s+years?/, "first");
await saveModal($page);

// ── 6C. Travelers — Primary Residence Type ───────────────
await ensureChecked($page, "BSC-AUTO-002152_TravelersPrimaryResidenceType");
await pickModalRadio($page, /^other$/, "first");
await saveModal($page);
// Take a screenshot after the page has loaded
const sss3 = "C:/InsuranceQuote/screenshot3.png";
await $page.screenshot({ path: sss3, fullPage: true });
// ─────────────────────────────────────────────────────────────
//  7.  PREMIUMS TAB
// ─────────────────────────────────────────────────────────────

await $page.click('.tabs__list .tabs__item a[href*="premiums"]');
await $page.waitForSelector("table.table tbody tr", { timeout: 15000 });
// Take a screenshot after the page has loaded
const sss4 = "C:/InsuranceQuote/screenshot4.png";
await $page.screenshot({ path: sss4, fullPage: true });

// Save quote
await $page.waitForSelector("button.app-button.app-button--save-quote", {
  visible: true,
  timeout: 10000,
});
await $page.$eval("button.app-button.app-button--save-quote", (el) =>
  el.scrollIntoView({ block: "center" }),
);
await $page.click("button.app-button.app-button--save-quote", { delay: 50 });
await sleep(2000);

// Wait until "Rate All Plans" button is visible then click
await $page.waitForFunction(
  () => {
    const btns = Array.from(document.querySelectorAll("a.o-btn"));
    return btns.some(
      (b) =>
        (b.textContent || "").trim().toLowerCase() === "rate all plans" &&
        b.offsetParent !== null,
    );
  },
  { timeout: 15000 },
);

const rateAllClicked = await $page.evaluate(() => {
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const target = Array.from(document.querySelectorAll("a.o-btn")).find(
    (a) => norm(a.textContent) === "rate all plans" && a.offsetParent !== null,
  );
  if (!target) return false;
  target.scrollIntoView({ block: "center" });
  const opts = { bubbles: true, cancelable: true };
  target.dispatchEvent(new MouseEvent("mouseover", opts));
  target.dispatchEvent(new MouseEvent("mousedown", opts));
  target.dispatchEvent(new MouseEvent("mouseup", opts));
  target.dispatchEvent(new MouseEvent("click", opts));
  return true;
});
if (!rateAllClicked) throw new Error('Could not click "Rate All Plans"');

// Give the site time to actually rate every carrier before we go looking
// for results. 30s covers the normal case; we still poll a bit past that
// as a safety margin rather than failing the instant 30s is up.
await sleep(30000);

await $page.waitForSelector("table.table tbody tr", { timeout: 15000 });

let summaryOpened = await findAndOpenPlanSummary($page);
// Some carriers post their premium slower than others. Retry a few more
// times (5s apart, ~30s extra) before giving up, instead of a single
// all-or-nothing check right at the 30s mark.
for (let attempt = 0; attempt < 6 && !summaryOpened; attempt++) {
  await sleep(5000);
  summaryOpened = await findAndOpenPlanSummary($page);
}

if (!summaryOpened) {
  const sssNoPlans = "C:/InsuranceQuote/screenshot_error_no_plans.png";
  await $page.screenshot({ path: sssNoPlans, fullPage: true }).catch(() => {});
  throw new Error(
    "No plan row with a 'View Plan Summary' button was found after ~60s of waiting. This means rating either hasn't finished, failed outright, or every carrier landed on 'Review'/'Error' instead of a summary (MAIP (CAR) and MAPFRE never expose 'View Plan Summary' — that's expected, not a bug). See screenshot_error_no_plans.png.",
  );
}
await sleep(3000);

// ─────────────────────────────────────────────────────────────
//  8.  CAPTURE PDF — intercept Blob created by "Print Long Proposal"
// ─────────────────────────────────────────────────────────────

const BLOB_HOOK = () => {
  (function () {
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
  await $page.evaluateOnNewDocument(BLOB_HOOK);
} else {
  await $page.evaluate(BLOB_HOOK).catch(() => {});
}

const popupPromise = new Promise((resolve) => {
  $page.once("popup", async (p) => {
    try {
      if (p.evaluateOnNewDocument) await p.evaluateOnNewDocument(BLOB_HOOK);
      else await p.evaluate(BLOB_HOOK).catch(() => {});
    } catch (_) {}
    resolve(p);
  });
});

// The print launcher only exists once the plan summary/proposal panel has
// actually rendered. Instead of a single wait that either finds it or
// throws a bare timeout, retry re-opening the summary a couple of times
// and take a diagnostic screenshot before giving up with a clear message.
let printLauncherFound = false;
for (let attempt = 0; attempt < 3 && !printLauncherFound; attempt++) {
  printLauncherFound = await $page
    .waitForSelector("#tooltipLauncherPrint", { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  if (!printLauncherFound) {
    console.warn(
      `#tooltipLauncherPrint not found (attempt ${attempt + 1}/3), retrying plan summary...`,
    );
    await findAndOpenPlanSummary($page).catch(() => {});
    await sleep(3000);
  }
}

if (!printLauncherFound) {
  await $page
    .screenshot({
      path: "C:/InsuranceQuote/screenshot_error_no_print_launcher.png",
      fullPage: true,
    })
    .catch(() => {});
  throw new Error(
    "Plan summary/proposal page never rendered the print launcher after 3 attempts — most likely no rated plan was actually available to view. Check screenshot_error_no_print_launcher.png and screenshot4.png (Premiums tab) to see what rating actually returned.",
  );
}

await $page.$eval("#tooltipLauncherPrint", (el) => {
  el.scrollIntoView({ block: "center" });
  el.click();
});
await $page.waitForSelector(".tooltip__menu", { timeout: 10000 });

const clickedProposal = await $page.evaluate(() => {
  const target = Array.from(
    document.querySelectorAll(".tooltip__menu a.tooltip__menu-link"),
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
if (!clickedProposal) throw new Error('Could not find "Print Long Proposal"');

// Detect new popup tab
let newTab = null;
try {
  newTab = await Promise.race([popupPromise, sleep(1500).then(() => null)]);
} catch (_) {}

// Allow blob creation to complete
if (newTab) {
  await newTab.bringToFront().catch(() => {});
  await Promise.race([
    newTab
      .waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 })
      .catch(() => {}),
    newTab.waitForSelector("body", { timeout: 15000 }).catch(() => {}),
    sleep(2000),
  ]);
} else {
  await Promise.race([
    $page
      .waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 })
      .catch(() => {}),
    sleep(2000),
  ]);
}

// Pull captured PDF bytes from main tab and popup
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

const mainBufs = await pullFrom($page);
const popupBufs = newTab ? await pullFrom(newTab) : [];
let allBufs = mainBufs.concat(popupBufs).filter((b) => b && b.length);

// Fallback: network-level sniff for PDF responses
if (!allBufs.length) {
  const pdfs = [];
  const sniff = async (resp) => {
    try {
      const headers = resp.headers() || {};
      const ct = (headers["content-type"] || "").toLowerCase();
      const cd = (headers["content-disposition"] || "").toLowerCase();
      const buf = await (resp.buffer
        ? resp.buffer()
        : Buffer.from(await resp.arrayBuffer()));
      if (!buf || !buf.length) return;
      const isPdf =
        ct.includes("application/pdf") ||
        cd.includes(".pdf") ||
        buf.slice(0, 5).toString("ascii") === "%PDF-";
      if (isPdf) pdfs.push(buf);
    } catch (_) {}
  };
  $page.on("response", sniff);
  if (newTab) newTab.on("response", sniff);
  await sleep(3000);
  $page.off("response", sniff);
  if (newTab) newTab.off("response", sniff);
  allBufs = pdfs;
}

if (!allBufs.length) {
  throw new Error(
    "No PDF captured. The app may be rendering print-HTML instead of a PDF blob.",
  );
}

// Pick the largest buffer
allBufs.sort((a, b) => b.length - a.length);
const pdfBuffer = allBufs[0];

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

return [
  {
    json: {
      message: "PDF captured successfully",
      email: email,
      licenseNo: licenseNo,
      fileName: fileName,
    },
    binary: {
      proposal: {
        data: pdfBuffer.toString("base64"),
        mimeType: "application/pdf",
        fileName: fileName,
      },
    },
  },
];
