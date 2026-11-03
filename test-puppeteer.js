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
//     to 3x with a clear error on final failure.
// ============================================================

// ─────────────────────────────────────────────────────────────
//  0.  TOP-LEVEL HELPERS  (available everywhere in this script)
// ─────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function formatDateToMMDDYYYY(dateStr) {
  if (!dateStr) return "";
  // "YYYY-MM-DD" is parsed by Date as UTC midnight, which shifts to the
  // previous day on servers west of UTC — read the parts directly instead.
  const iso = String(dateStr).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return `${iso[2].padStart(2, "0")}${iso[3].padStart(2, "0")}${iso[1]}`;
  }
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

// Pick an option from a select-like dropdown: the first option whose text
// contains `prefer` (e.g. "sedan"), else the first option. Waits for the
// options to load (trims load async after model) and verifies the input
// ended up with a value. Returns the input's final value ("" = failed).
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
        // options inside the input's own wrapper first, then global overlays
        const root =
          host?.closest(".sm-input-select,.autocomplete,.ng-select,.mat-select,.dropdown") ||
          null;
        for (const scope of [root, document].filter(Boolean)) {
          for (const sel of sels) {
            const opts = Array.from(scope.querySelectorAll(sel)).filter(
              (n) => visible(n) && (n.textContent || "").trim(),
            );
            if (!opts.length) continue;
            const p = (prefer || "").toLowerCase();
            const hit =
              (p && opts.find((n) => n.textContent.toLowerCase().includes(p))) ||
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

// Find a visible date-of-birth input inside the element matching rootSel
// (by id/name/placeholder or by its label text). Tags it with
// data-dob-target and returns a selector for it, or null.
async function findDobInput(page, rootSel = "body") {
  return page.evaluate((rootSel) => {
    // never fall back to the whole page — it would grab the driver DOB field
    const root = document.querySelector(rootSel);
    if (!root) return null;
    const visible = (n) => !!(n.offsetParent || n.getClientRects().length);
    const re = /birth|\bdob\b/i;
    const inputs = Array.from(root.querySelectorAll("input")).filter(visible);
    let target = inputs.find((i) =>
      re.test(`${i.id} ${i.name} ${i.placeholder} ${i.getAttribute("aria-label") || ""}`),
    );
    if (!target) {
      for (const lbl of root.querySelectorAll("label, .o-label, th, td, span, div")) {
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

// Open the "Client:" box edit form, set client DOB, click "Update info".
async function setClientDob(page, mmddyyyy) {
  const opened = await page.evaluate(() => {
    const box = Array.from(document.querySelectorAll(".aboutbox")).find(
      (b) => b.querySelector(".aboutbox__title")?.textContent.trim() === "Client:",
    );
    const link = box?.querySelector("a.aboutbox__link");
    if (!link) return false;
    link.scrollIntoView({ block: "center" });
    link.click();
    return true;
  });
  if (!opened) return false;
  await page
    .waitForSelector("#clientInfoAddrZip_StreetAddress", { timeout: 10000 })
    .catch(() => {});
  await sleep(500);
  const ok = await fillClientDobInOpenForm(page, mmddyyyy);
  await clickUpdateInfo(page);
  return ok;
}

// With the client info form already open, fill its DOB field.
async function fillClientDobInOpenForm(page, mmddyyyy) {
  if (!mmddyyyy) return false;
  // scope to the form/modal that holds the client address fields
  await page.evaluate(() => {
    document
      .querySelectorAll("[data-client-form]")
      .forEach((n) => n.removeAttribute("data-client-form"));
    const zip = document.querySelector("#clientInfoAddrZip_StreetAddress");
    const root =
      zip?.closest(".modalbox__content, .modalbox, [role='dialog'], .sm-popup, form") ||
      null;
    if (root) root.setAttribute("data-client-form", "1");
  });
  const sel =
    (await page.$("#clientInfoDateOfBirth").then((h) => (h ? "#clientInfoDateOfBirth" : null))) ||
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
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button.o-btn")).find(
      (b) => b.textContent.trim() === "Update info",
    );
    if (btn) {
      btn.scrollIntoView({ block: "center" });
      btn.click();
    }
  });
  await sleep(3000);
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

  // Already checked → clicking would toggle it OFF, so leave it alone
  const already = await page
    .$eval(SEL_INPUT, (el) => !!el.checked)
    .catch(() => false);
  if (already) return false;

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
  return true;
}

// Answers for known required Options items (matched by item title).
// Anything not listed here gets the first radio in its modal.
const REQUIRED_OPTION_ANSWERS = [
  { match: /length of time for continuous coverage/i, answer: /36\s*\+\s*months?/, fallback: "last" },
  { match: /travelers.*continuous insurance/i, answer: /less\s+than\s+3\s+years?/, fallback: "first" },
  { match: /travelers.*primary residence type/i, answer: /^other$/, fallback: "first" },
];

// Find Options items shown in red (required) that are still unchecked.
// Returns [{ baseId, title }]. Red is detected from the computed text color,
// so it works no matter which carriers/items a given client shows.
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

// Check every red/required Options item and answer its modal if one opens.
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
          await pickModalRadio(page, rule ? rule.answer : /(?!)/, rule ? rule.fallback : "first");
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
// to wait for a carrier row to finish and expose "View plan summary".

// Find (and optionally click) a visible, enabled button in a premiums row
// whose label matches textRe. carrier limits it to that carrier's row;
// excludeCarrier skips that carrier's row.
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

async function goToTab(page, name) {
  await page.click(`.tabs__list .tabs__item a[href*="${name}"]`);
  await sleep(1500);
}

// Debug snapshot of a tab: URL, open modals, and every visible input /
// select with its id, name, label text and current value. Used to find the
// real selectors when a fixer can't find or set a field.
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
        el.closest(".o-field, .form-group, tr, .row, div")?.querySelector("label, .o-label, th")
          ?.textContent ||
        "";
      return t.replace(/\s+/g, " ").trim().slice(0, 60);
    };
    return {
      url: location.href,
      modals: Array.from(
        document.querySelectorAll('.modalbox__content, [role="dialog"], .sm-popup.is-active'),
      )
        .filter(visible)
        .map((m) => (m.innerText || "").replace(/\s+/g, " ").slice(0, 120)),
      fields: Array.from(document.querySelectorAll("input, select, textarea"))
        .filter((el) => visible(el) && el.type !== "hidden")
        .slice(0, 80)
        .map((el) => ({
          id: el.id || undefined,
          name: el.name || undefined,
          cls: (el.className || "").toString().slice(0, 50) || undefined,
          label: labelOf(el) || undefined,
          value: el.type === "checkbox" ? el.checked : (el.value || "").slice(0, 40),
          disabled: el.disabled || undefined,
        })),
    };
  });
}

// Clear + type into a datepicker input; returns true if a full date stuck
async function setDateInput(page, sel, mmddyyyy) {
  await page.waitForSelector(sel, { visible: true, timeout: 10000 });
  await page.$eval(sel, (el) => el.scrollIntoView({ block: "center" }));
  await page.click(sel, { clickCount: 3 }).catch(() => {});
  for (let i = 0; i < 12; i++) await page.keyboard.press("Backspace");
  await page.keyboard.type(mmddyyyy, { delay: 100 });
  await page.keyboard.press("Tab");
  await sleep(300);
  return page
    .$eval(sel, (el) => (el.value || "").replace(/\D/g, "").length >= 8)
    .catch(() => false);
}

// Clear + type into a plain text input and fire input/change events
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
      el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    sel,
    String(value),
  );
  await page.keyboard.press("Tab");
  await sleep(300);
}

async function clickRateAllPlans(page) {
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

// Snapshot of each premiums row: carrier text + visible button labels
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

// Poll until the premiums table stops changing (every row settled on
// Summary/Review/Rate/Error). Returns early once one of `carriers` (or any
// row, if null) exposes "View plan summary". Does not click anything.
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

// Open each row's "Review" modal, collect the warning lines, close it.
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

    // close the modal
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
const vehicleBody = String($json.body?.v1_body || "").trim(); // e.g. "Sedan"
const vehicleZip = String($json.body?.v1_zip || "").trim();
const address1 = String($json.body?.residential_address || "").trim();
const city = String(
  $json.body?.step_1_data?.city || $json.body?.city || "",
).trim();
const state = String($json.body?.state || "").trim();
const zip = String($json.body?.zip || vehicleZip).trim();
const email = String($json.body?.email || "").trim();
const agentCode = String($json.body?.agent_code || $json.agent_code || "")
  .trim()
  .toUpperCase();
// Agent JRN always wants a MAIP plan; others keep the default priority.
const IS_JRN = agentCode === "JRN";

// Vehicle garaging zip: fall back to the client zip when v1_zip is missing
// (that empty value is what produced "Zip Code not set for <vehicle>").
const locationZip = vehicleZip || zip;

// First Licensed is required by every carrier. When the webhook doesn't
// send d1_lic_date, assume DOB + 18 years (capped at today) so rating can
// proceed — the quote will reflect that assumption.
function deriveFirstLicenseDate(dob) {
  const d = new Date(dob);
  if (isNaN(d.getTime())) return "";
  d.setFullYear(d.getFullYear() + 18);
  const now = new Date();
  const use = d > now ? now : d;
  return `${use.getMonth() + 1}/${use.getDate()}/${use.getFullYear()}`;
}
const effectiveFirstLicenseDate =
  firstLicenseDate || deriveFirstLicenseDate(dobRaw);
if (!firstLicenseDate)
  console.warn(
    `d1_lic_date missing — using derived First Licensed date ${effectiveFirstLicenseDate}`,
  );

if (!licenseNo) throw new Error("Missing d1_lic_num in input JSON");

// ─────────────────────────────────────────────────────────────
//  2.  LOGIN
// ─────────────────────────────────────────────────────────────

await $page.goto("https://apps.singlepointrating.com/webapps/sprapp/#/login", {
  waitUntil: "networkidle2",
  timeout: 30000,
});

// The SPA renders the form after networkidle2, and the field name casing
// isn't guaranteed — match loosely. If a previous session is still active
// the app skips the login form and lands on the dashboard (.sidebox).
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
    .evaluate(() => ({
      url: location.href,
      title: document.title,
      inputs: Array.from(document.querySelectorAll("input")).map(
        (i) => `${i.tagName} name=${i.name} id=${i.id} type=${i.type}`,
      ),
    }))
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

  if (effectiveFirstLicenseDate) {
    await setDateInput(
      $page,
      "#driverFirstLicensed",
      formatDateToMMDDYYYY(effectiveFirstLicenseDate),
    );
  }

  await $page.waitForSelector("#driverSdip", { visible: true, timeout: 5000 });
  await $page.type("#driverSdip", "00", { delay: 100 });
  await $page.keyboard.press("Tab");
  await sleep(500);
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
  const dobOk = await setDateInput($page, "#driverDateOfBirth", dobFormatted);
  if (!dobOk) console.warn(`Driver DOB did not stick (${dobFormatted})`);

  await $page.waitForSelector("#driverRelationshipToInsured", {
    timeout: 10000,
  });
  await $page.click("#driverRelationshipToInsured", { clickCount: 3 });
  await $page.keyboard.press("Backspace");
  await $page.keyboard.type("Insured", { delay: 100 });
  await $page.keyboard.press("Tab");

  if (effectiveFirstLicenseDate) {
    await setDateInput(
      $page,
      "#driverFirstLicensed",
      formatDateToMMDDYYYY(effectiveFirstLicenseDate),
    );
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

  // Client DOB (otherwise: "Required Date of Birth for client.")
  await fillClientDobInOpenForm($page, formatDateToMMDDYYYY(dobRaw)).catch(
    (e) => console.warn("Client DOB fill failed:", e.message),
  );

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
    // No trim in the webhook — prefer a trim matching the body style
    // (v1_body, e.g. "Sedan"), else the first one. Selecting a trim is what
    // fills VIN pattern, body style, Price New/Value and symbols.
    console.warn(
      `No trim value supplied by webhook — picking a trim${vehicleBody ? ` matching "${vehicleBody}"` : ""}.`,
    );
    const trimValue = await selectOptionPreferring($page, "#vehicleTrim", vehicleBody);
    if (!trimValue) console.warn("Trim still empty after selection attempts");
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
await $page.keyboard.type(locationZip, { delay: 100 });
await $page.evaluate((v) => {
  const input = document.querySelector("#vehicleLocationZip");
  if (!input) return;
  input.value = v;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}, locationZip);

await $page.waitForSelector("#vehicleAnnualMiles", { timeout: 10000 });
await $page.click("#vehicleAnnualMiles", { clickCount: 3 });
await $page.keyboard.press("Backspace");
await $page.keyboard.type("10000", { delay: 100 });
await $page.keyboard.press("Tab");
await sleep(1000);
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

// ── 6A. Required (red) option items ──────────────────────
// Different clients show different carriers/items, and some are already
// checked. Detect whatever is red + unchecked and handle only those.
await handleRequiredOptions($page);
// ─────────────────────────────────────────────────────────────
//  7.  PREMIUMS TAB
// ─────────────────────────────────────────────────────────────

await $page.click('.tabs__list .tabs__item a[href*="premiums"]');
await $page.waitForSelector("table.table tbody tr", { timeout: 15000 });

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

// Each known Review warning maps to a fix on the right tab. Add a new entry
// here whenever a run fails with an "Unhandled review warnings" error.
const REVIEW_FIXERS = [
  {
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
    match: /zip code not set/i,
    fix: async (page) => {
      if (!locationZip) return false;
      await goToTab(page, "vehicles");
      await setTextInput(page, "#vehicleLocationZip", locationZip);
      return true;
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
      await goToTab(page, "drivers");
      return setClientDob(page, dob);
    },
  },
  {
    // All of these come from the vehicle having no trim selected (no VIN in
    // the webhook) — re-pick the trim once for all of them.
    key: "vehicleTrim",
    match:
      /invalid vin|body style not selected|price new \/ value|symbols are required/i,
    fix: async (page) => {
      if (vehicleVin) return false; // a real VIN was given — don't override
      await goToTab(page, "vehicles");
      return !!(await selectOptionPreferring(page, "#vehicleTrim", vehicleBody));
    },
  },
];

// Rate All → open a plan summary: MAPFRE first, then MAIP (CAR), then any
// other rated plan. If every plan lands on Review: resolve Arbella's
// warnings, then rate Arbella. If after that Arbella is still in Review but
// another plan shows "Rate", rate and use that plan instead.
const SUMMARY_PRIORITY = ["MAPFRE", "MAIP"];
const PREFERRED_CARRIER = "Arbella";
const MAX_RATE_ROUNDS = 8;
const fixedWarnings = new Set();
let summaryOpened = false;
let summaryCarrier = null;
let preferredResolveTried = false;

// Run REVIEW_FIXERS over a list of warnings; returns the ones it couldn't fix.
async function applyReviewFixers(page, warnings) {
  const unhandled = [];
  const ranThisCall = new Map(); // fixer key → result (run shared fixers once)
  for (const w of warnings) {
    const fixer = REVIEW_FIXERS.find((f) => f.match.test(w));
    if (!fixer) {
      unhandled.push(w);
      continue;
    }
    if (fixedWarnings.has(w)) {
      unhandled.push(`${w} (still present after fixing)`);
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
    if (ok) fixedWarnings.add(w);
    else unhandled.push(`${w} (fix ran but field missing or value didn't stick)`);
  }
  return unhandled;
}

await clickRateAllPlans($page);
console.log("Rate All Plans clicked");
await waitForRatingSettled($page, IS_JRN ? ["MAIP"] : SUMMARY_PRIORITY);

// Agent JRN: try hard to get MAIP (rate it / resolve its Review warnings).
// If MAIP can't be rated or its warnings can't be resolved, fall through to
// the normal flow below, which picks another plan.
if (IS_JRN) {
  const MAIP = "MAIP";
  for (let round = 1; round <= MAX_RATE_ROUNDS; round++) {
    if (await findAndOpenPlanSummary($page, MAIP)) {
      summaryOpened = true;
      summaryCarrier = MAIP;
      console.log("JRN: MAIP plan summary opened");
      break;
    }

    if (await rowButton($page, RATE_RE, { carrier: MAIP })) {
      console.log(`JRN: rating MAIP (round ${round})`);
      await waitForRatingSettled($page, [MAIP]);
      continue;
    }

    const maipInReview = await rowButton($page, REVIEW_RE, {
      carrier: MAIP,
      click: false,
    });
    if (!maipInReview) {
      console.warn("JRN: MAIP is not ratable (no Rate/Review) — using another plan");
      break;
    }

    const warnings = await collectReviewWarnings($page, MAIP);
    console.log(`JRN: MAIP review warnings (round ${round}):`, warnings);
    const unhandled = warnings.length
      ? await applyReviewFixers($page, warnings)
      : ["(no warnings found)"];
    if (unhandled.length) {
      console.warn(
        "JRN: can't resolve MAIP warnings — using another plan:",
        unhandled,
      );
      break;
    }

    await goToTab($page, "premiums");
    await $page.waitForSelector("table.table tbody tr", { timeout: 15000 });
    await sleep(2000);
  }
}

for (let round = 1; round <= MAX_RATE_ROUNDS && !summaryOpened; round++) {
  // 1. A rated plan is available → open it (MAPFRE, MAIP, then any other)
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

  // 2. Arbella is ready to rate → rate it
  if (await rowButton($page, RATE_RE, { carrier: PREFERRED_CARRIER })) {
    console.log(`Rating ${PREFERRED_CARRIER} (round ${round})`);
    await waitForRatingSettled($page, [PREFERRED_CARRIER]);
    continue;
  }

  // 3. Arbella is stuck (still Review after resolving, or Error) and some
  //    other plan is ready to rate → rate that one
  const preferredInReview = await rowButton($page, REVIEW_RE, {
    carrier: PREFERRED_CARRIER,
    click: false,
  });
  if (
    (!preferredInReview || preferredResolveTried) &&
    (await rowButton($page, RATE_RE, { excludeCarrier: PREFERRED_CARRIER }))
  ) {
    console.log(
      `${PREFERRED_CARRIER} not ratable — rating another plan (round ${round})`,
    );
    await waitForRatingSettled($page);
    continue;
  }

  // 4. Resolve Review warnings: Arbella's if it's in Review, else every row's
  const reviewTarget = preferredInReview ? PREFERRED_CARRIER : null;
  if (preferredInReview) preferredResolveTried = true;
  const warnings = await collectReviewWarnings($page, reviewTarget);
  console.log(
    `Review warnings for ${reviewTarget || "all plans"} (round ${round}):`,
    warnings,
  );

  if (!warnings.length) {
    const states = await getPremiumRowStates($page).catch(() => []);
    throw new Error(
      `No 'View Plan Summary' and no Review warnings found. Row states: ${JSON.stringify(states)}`,
    );
  }

  const unhandled = await applyReviewFixers($page, warnings);

  if (unhandled.length) {
    const diag = {
      drivers: await describeTab($page, "drivers").catch((e) => e.message),
      vehicles: await describeTab($page, "vehicles").catch((e) => e.message),
    };
    console.log("Page diagnostics:", JSON.stringify(diag, null, 2));
    throw new Error(
      `Unhandled review warnings — add a fixer in REVIEW_FIXERS: ${JSON.stringify(unhandled)}\n` +
        `DIAGNOSTICS: ${JSON.stringify(diag)}`,
    );
  }

  // back to Premiums; the next round rates whatever is now ratable
  await goToTab($page, "premiums");
  await $page.waitForSelector("table.table tbody tr", { timeout: 15000 });
  await sleep(2000);
}

if (!summaryOpened) {
  const states = await getPremiumRowStates($page).catch(() => []);
  throw new Error(
    `No 'View Plan Summary' after ${MAX_RATE_ROUNDS} rate rounds. Row states: ${JSON.stringify(states)}`,
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
// before giving up with a clear message.
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
    await findAndOpenPlanSummary($page, summaryCarrier).catch(() => {});
    await sleep(3000);
  }
}

if (!printLauncherFound) {
  throw new Error(
    "Plan summary/proposal page never rendered the print launcher after 3 attempts — most likely no rated plan was actually available to view. Check the Premiums tab to see what rating actually returned.",
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
